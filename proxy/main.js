// ======================================================== //
const _ = require('lodash');
const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const dom = require('xmldom').DOMParser;
const xpath = require('xpath');

// === Do not proxy these headers from the browser to the i2b2 server ===
// Prevents security issues with SAML Authentication
const ignoreHeaders = [
    "X-eduPersonPrincipalName",
    "X-Shib-Session-ID"
];

// configuration
// ======================================================== //
global.baseDir = __dirname.split(path.sep).slice(0,-1).join(path.sep);
global.hostingDir = path.join(baseDir, 'webclient');
global.configDir = path.join(baseDir, 'config');
global.cryptoKeyDir = path.join(configDir, 'crypto-keys');

// read the configuration from "/config/proxy_settings.json"
let data = JSON.parse(fs.readFileSync(path.join(configDir, "proxy_settings.json")));
global.systemConfiguration = data; //<=== accessable in modules too

// deal with whitelist in single centralized function
// ================================================================================================================== //
let whitelist = JSON.parse(fs.readFileSync(path.join(configDir, "whitelist.json")));
global.inWhitelist = function(url) {
    try {
        let target = new URL(url);

        // normalize given URL
        let hostUrl =  target.protocol + target.host;
        hostUrl = hostUrl.toUpperCase();

        let allowedHostUrls  = [];
        if (whitelist && Object.keys(whitelist).length > 0) {
            // create a list of normalized entries to search
            let protocol = target.protocol.replace(/:$/, '');
            whitelist[protocol].forEach(element => allowedHostUrls.push((target.protocol + element).toUpperCase()));
            // search the list for our URL
            if (allowedHostUrls.includes(hostUrl)) return true;
            return false;
        }
    } catch (e) {
        return false;
    }
};
// ================================================================================================================== //

// logging setup
let loggerSettings = {};
if (systemConfiguration.logging)  loggerSettings = systemConfiguration.logging;
const logger = require('pino')(loggerSettings);
global.logger = logger;

// manage all default system configuration settings
if (systemConfiguration.redirection !== undefined) {
    if (systemConfiguration.redirection.port === undefined) systemConfiguration.redirection.port = 80;
    if (process.env.REDIRECT_PORT) systemConfiguration.redirection.port = process.env.REDIRECT_PORT;
}
const proxyConfig = systemConfiguration.proxy;
if (proxyConfig.protocol === undefined) proxyConfig.protocol = "https";
if (proxyConfig.port === undefined) {
    if (proxyConfig.protocol === "https") {
        proxyConfig.port = 443;
    } else {
        proxyConfig.port = 80;
    }
}
if (process.env.PROXY_PORT !== undefined)  proxyConfig.port = process.env.PROXY_PORT;
if (proxyConfig.protocol === "https") {
    // prefix the location of the "crypto-keys" directory to the cert/key filenames given
    proxyConfig.httpsCert = path.join(cryptoKeyDir, proxyConfig.httpsCert);
    proxyConfig.httpsKey = path.join(cryptoKeyDir, proxyConfig.httpsKey);
}

// handle acceptance (or not) of self-signed certificates when proxying
if (systemConfiguration.proxyToSelfSignedSSL) {
    logger.error((new Error("Self-signed SSL certificates are now allowed!")), 'To prevent Proxy service from allowing the use of self-signed SSL certificates edit this location in code!');
    logger.warn({}, 'THE PROXY SERVER IS CONFIGURED TO ALLOW SELF-SIGNED CERTIFICATES');
    // Insanely insecure hack to accept self-signed SSL Certificates (if configured)
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
} else {
    logger.warn({}, 'The proxy server is configured to REJECT self-signed certificates');
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
}


// HTTP listener that redirects to HTTPS
// ======================================================== //
if (systemConfiguration.redirection !== undefined) {
    const functDoRedirect = function(req, res) {
        let hostname = req.headers.host;
        if (!hostname) {
            logger.error((new Error("Invalid HTTP request")), 'The proxy server received a non-request connection from: ' + req.ip);
            res.sendStatus(400);
            return false;
        }
        hostname = hostname.split(':')[0];
        if ((systemConfiguration.proxy.protocol === "https" && systemConfiguration.proxy.port === 443) ||
            (systemConfiguration.proxy.protocol === "http" && systemConfiguration.proxy.port === 80)) 
        {
            res.redirect(systemConfiguration.proxy.protocol + '://' + hostname + req.url);
        } else {
            res.redirect(systemConfiguration.proxy.protocol + '://' + hostname + ':' + systemConfiguration.proxy.port + req.url);
        }
    };
    const serviceRedirect = express();
    if (systemConfiguration.useCORS) serviceRedirect.use(cors());
    serviceRedirect.disable('x-powered-by');
    serviceRedirect.get('*', functDoRedirect);
    serviceRedirect.post('*', functDoRedirect);
    const redirPort = systemConfiguration.redirection.port;
    const httpServer = http.createServer(serviceRedirect);
    httpServer.listen(redirPort, () => {
        let msg = 'HTTP Redirect Service running on port ' + redirPort;
        logger.warn({"redirection": {
            "from": 'http:'+redirPort,
            "to": systemConfiguration.proxy.protocol+':'+systemConfiguration.proxy.port
            }}, msg);
    });
}
// ======================================================== //



// build the proxy service
// ======================================================== //
const serviceProxy = express();
if (systemConfiguration.useCORS) serviceProxy.use(cors());
serviceProxy.disable('x-powered-by');

// manage overriding/mapping of config files
serviceProxy.use(require(path.join(baseDir, "proxy", "config-files.js")));

// use SAML if configured
if (systemConfiguration.useSAML) {
    let moduleFile = path.join(baseDir, "proxy", "saml.js");
    try {
        serviceProxy.use("/saml", require(moduleFile));
        logger.warn({saml: {
            enabled:true,
            module: moduleFile
        }}, "SAML use is enabled");
    } catch(e) {
        logger.error({saml: {enabled:true, module:moduleFile}, error: e}, "Error enabling SAML support");
    }
} else {
    logger.warn({saml: {enabled:false}}, "SAML support is NOT enabled");
}


// use GitManager if configured
if (systemConfiguration.gitManager && systemConfiguration.gitManager.active) {
    let moduleFile = path.join(baseDir, "proxy", "git-manager.js");
    try {
        serviceProxy.use(systemConfiguration.gitManager.managerUrl, require(moduleFile));
        logger.warn({"gitmanager": {
            enabled: true,
            module: moduleFile,
            url: systemConfiguration.gitManager.managerUrl }
        }, "GitManager is enabled");
    } catch(e) {
        logger.error({"gitmanager": {
                enabled: true,
                module: moduleFile,
                url: systemConfiguration.gitManager.managerUrl },
            error: e
        }, "Error enabling GitManager");
    }
} else {
    logger.warn({"gitmanager": {enabled: false}}, "GitManager is NOT enabled");
}


// serve the static files
// -------------------------------------------------------- //
serviceProxy.use(express.static(hostingDir));
logger.warn({"static_hosting": {dir: hostingDir}}, "Hosting web client found in " + hostingDir);

// proxy service
// -------------------------------------------------------- //
serviceProxy.use(function(req, res, next) {
    if (req._parsedUrl.pathname !== systemConfiguration.proxyUrl) {
        next();
    } else {
        // logging output
        let logObject = {};
        let client_ip = req.headers['x-forwarded-for'] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.connection.socket.remoteAddress;
        let startTimestamp = (new Date()).toISOString();
        logObject.timestamp = startTimestamp;
        logObject.client_ip = client_ip;

        let body = [];
        let body_len = 0;

        req.on('data', function(data) {
            body.push(data);
            body_len += data.length;
            if (body_len > systemConfiguration.maxBodySize) {
                // FLOOD ATTACK OR FAULTY CLIENT, NUKE REQUEST
                req.connection.destroy();
                // logging output
                logObject.errorMsg = "EXCESSIVE UPLOAD SIZE";
                logObject.body_len = body_len;
                logger.error(logObject, "Proxy request body was larger than " + body_len + " bytes");
            }
        });
        req.on('end', function() {
            logObject.body_len = body_len;
            let headers = {};
            // load the xml send in POST body and extract the redirect URL value
            try {
                const doc_str = String(Buffer.concat(body));
                const xml = new dom().parseFromString(doc_str);
                let domain = xpath.select("//security/domain/text()", xml)[0].toString();
                let usrname = xpath.select("//security/username/text()", xml)[0].toString();
                // log credentials
                logObject.credentials = {
                    domain: domain,
                    username: usrname
                };
                // forward the request to the redirect URL
                let proxy_to = xpath.select("//proxy/redirect_url/text()", xml)[0].toString();
                logObject.service = proxy_to;
                proxy_to = new URL(proxy_to);

                let abort = false;
                 _.forEach(req.headers, (value, key) => {
                     // SECURITY: Filter out forbidden headers, needed for i2b2 Java server implementation of SAML2
                     if (ignoreHeaders.find(badHeader => key.toLowerCase() === badHeader.toLowerCase() ) === undefined) {
                         headers[key] = value;
                     } else {
                         // log header injection
                         logObject.request_headers = req.headers;
                         logObject.request_body = doc_str;
                         logger.error(logObject, 'CLIENT ATTEMPTED TO INJECT FORBIDDEN HEADER "' + key + '" = "' + value + '", request terminated');
                         // end the connection
                         abort = true;
                     }
                });
                if (abort) {
                    // Terminating connection with 403
                    res.sendStatus(403).end();
                    return;
                }
                headers["Content-Type"] = 'text/xml';
                headers["forwarded"] = `for=${client_ip}`;
                headers["x-forwarded-for"] = client_ip;
                delete headers['cookie'];
                delete headers['host'];
                delete headers['origin'];
                delete headers['referer'];
                delete headers['content-length'];

                let opts = {
                    protocol: proxy_to.protocol,
                    hostname: proxy_to.hostname,
                    port: proxy_to.port,
                    path: proxy_to.pathname,
                    method: req.method,
                    headers: headers
                };

                //Check whitelist
                if (!inWhitelist(proxy_to.href)) {
                    let whitelistErr = "Host is not whitelisted: " + proxy_to.protocol + proxy_to.host;
                    logObject.request_headers = req.headers;
                    logObject.request_body = doc_str;
                    logObject.errorMsg = whitelistErr;
                    logger.error(logObject, 'Request to non-whitelisted host');
                    res.end(whitelistErr);
                    return;
                }

                let i2b2_result = [];
                const proxy_reqest_hdlr  = function(proxy_res) {
                    res.statusCode = proxy_res.statusCode;
                    _.forEach(proxy_res.headers, (value, key) => {
                        res.setHeader(key, value);
                    });
                    res.setHeader('i2b2-dev-svr-mode', 'Proxy');
                    res.removeHeader('set-cookie');
                    res.setHeader('Content-Type', 'text/xml');
                    proxy_res.on('data', (chunk) => {
                        i2b2_result.push(chunk);
                    });
                    proxy_res.on('end', () => {
                        let responseMsg = Buffer.concat(i2b2_result);
                        logObject.response_len = responseMsg.length;
                        logObject.response_status = proxy_res.statusCode;
                        logger.info(logObject, 'Successful proxy request');
                        res.end(responseMsg);
                    });
                    proxy_res.on('error', (e) => {
                        let responseMsg = Buffer.concat(i2b2_result);
                        logObject.error = e;
                        logObject.errorMsg = "An error occured during the proxy request";
                        logObject.response = responseMsg;
                        logObject.response_status = proxy_res.statusCode;
                        logObject.request_obj = proxy_res;
                        logger.error(logObject, 'Request to non-whitelisted host');
                        res.end(responseMsg);
                    });
                };

                let proxy_request;
                switch (proxy_to.protocol) {
                    case "http:":
                        proxy_request = http.request(opts, proxy_reqest_hdlr);
                        break;
                    case "https:":
                        proxy_request = https.request(opts, proxy_reqest_hdlr);
                        break;
                    default:
                        let msg = "proxy engine does not support protocol = " + proxy_to.protocol;
                        logObject.errorMsg = msg;
                        logObject.error = new Error("Invalid Protocol");
                        logger.error(logObject, "Invalid Protocol");
                        return false;
                        break;
                }
                proxy_request.on('error', (e) => {
                    let response = String(Buffer.concat(i2b2_result));
                    logObject.errorMsg = msg;
                    logObject.error = e;
                    logObject.response = response;
                    logObject.request_obj = proxy_request;
                    logger.error(logObject, "Problem with request/response");
                    res.end(response);
                });
                body = String(Buffer.concat(body));
                res.setHeader('i2b2-dev-svr-mode', 'Proxy');
                proxy_request.setHeader('Content-Type', 'text/xml');
                proxy_request.setHeader('Content-Length', body.length);
                proxy_request.end(body);
            } catch(e) {
                let response;
                try {
                    response = String(Buffer.concat(i2b2_result));
                } catch(e) {}
                logObject.errorMsg = "General Error";
                logObject.error = e;
                logger.error(logObject, "Internal Error");
                res.end("Internal Error Logged");
            }
        })
    }
});


// setup Proxy hosting server
// ======================================================== //
let func_startReporter = function() {
    let msg = proxyConfig.protocol.toUpperCase() + ' Proxy Server running on port ' + proxyConfig.port;
    logger.warn({proxy_server: {
        protocol: proxyConfig.protocol,
            port: proxyConfig.port
    }}, msg);
};
let proxyServer;
if (proxyConfig.protocol === 'https') {
    let settings = {
        key: fs.readFileSync(proxyConfig.httpsKey),
        cert: fs.readFileSync(proxyConfig.httpsCert),
    };
    if (proxyConfig.httpsPassphrase !== undefined) settings.passphrase = proxyConfig.httpsPassphrase;
    proxyServer = https.createServer(settings, serviceProxy);
    proxyServer.listen(proxyConfig.port, func_startReporter);
} else {
    proxyServer = http.createServer(serviceProxy);
    proxyServer.listen(proxyConfig.port, func_startReporter);
}
let starttime = (new Date()).toISOString();
logger.warn({"startup": {"datetime": starttime}}, ">>>> STARTED " + starttime + " <<<<");
