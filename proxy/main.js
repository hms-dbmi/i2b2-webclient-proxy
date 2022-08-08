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

// logging setup
const logger = require('pino')();


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
let whitelist = JSON.parse(fs.readFileSync(path.join(configDir, "whitelist.json")));

global.systemConfiguration = data; //<=== accessable in modules too

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
        const hostname = req.headers.host.split(':')[0];
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
    serviceRedirect.get('*', functDoRedirect);
    serviceRedirect.post('*', functDoRedirect);
    const redirPort = systemConfiguration.redirection.port;
    const httpServer = http.createServer(serviceRedirect);
    httpServer.listen(redirPort, () => { console.log('HTTP Redirect Service running on port ' + redirPort); });
}
// ======================================================== //



// build the proxy service
// ======================================================== //
const serviceProxy = express();
if (systemConfiguration.useCORS) {
    console.log("Proxy is using CORS");
    serviceProxy.use(cors());
}



// handle the configuration files
// -------------------------------------------------------- //
funcConfigFileReader = function(fileList, funcFound, funcNotFound) {
    let found = false;
    let data = "";
    let file = "";
    while (fileList.length) {
        file = fileList.shift();
        try {
            data = fs.readFileSync(file);
            found = true;
            break;
        } catch (e) {}
    }
    // log where the file is loaded from (ease debugging issues)
    let loadingFrom;
    if (file.startsWith(configDir)) {
        loadingFrom = "outside of docker, the configuration directory of the proxy server repo.";
    } else {
        loadingFrom = "within docker, the hosting directory of the webclient.";
    }

    console.log('"' + path.basename(file) + '" was loaded from ' + loadingFrom);

    if (found) {
        funcFound(data);
    } else {
        funcNotFound();
    }

};
// -------------------------------------------------------- //
serviceProxy.get('/i2b2_config_cells.json', (req, res) => {
    const files = [
        path.join(configDir, 'i2b2_config_cells.json'),
        path.join(hostingDir, 'i2b2_config_cells.json')
    ];
    funcConfigFileReader(
        files,
        (data) => {
            res.send(data);
        }, ()=> {
            res.sendStatus(404);
        }
    );
});
// -------------------------------------------------------- //
serviceProxy.get('/i2b2_config_domains.json', (req, res) => {
    const files = [
        path.join(configDir, 'i2b2_config_domains.json'),
        path.join(hostingDir, 'i2b2_config_domains.json')
    ];
    funcConfigFileReader(
        files,
        (data) => {
            // override the "urlProxy" property
            let newData = JSON.parse(data);
            newData.urlProxy = systemConfiguration.proxyUrl;
            res.send(JSON.stringify(newData, null, 4));
        }, ()=> {
            res.sendStatus(404);
        }
    );
});

// -------------------------------------------------------- //
serviceProxy.get('/plugins/plugins.json', (req, res) => {
    let plugins = [];
    function walkDir(dir) {
        let directoryListing = fs.readdirSync(dir);
        if (directoryListing.includes('plugin.json')) {
            plugins.push(dir);
            return;
        }
        for (let i in directoryListing) {
            let dirPath = path.join(dir, directoryListing[i]);
            if (fs.statSync(dirPath).isDirectory()) walkDir(dirPath);
        }
    }

    let pluginsDir = path.join(hostingDir, 'plugins');
    walkDir(pluginsDir);
    plugins.forEach((d, i) => {
        plugins[i] = d.replace(pluginsDir + path.sep, '').replaceAll(path.sep, '.');
    });
    res.send(JSON.stringify(plugins));

});


// use SAML if configured
if (systemConfiguration.useSAML) {
    console.log("System is using SAML configuration");
    serviceProxy.use("/saml", require(path.join(baseDir, "proxy", "saml.js")));
}


// use GitManager if configured
try {
    if (systemConfiguration.gitManager.active) {
        console.log("System is using Git Manager module");
        serviceProxy.use(systemConfiguration.gitManager.managerUrl, require(path.join(baseDir, "proxy", "git-manager.js")));
    }
} catch(e) {
    console.error("GitManager failed to load!");
    console.dir(e);
}



// serve the static files
// -------------------------------------------------------- //
serviceProxy.use(express.static(hostingDir));

// proxy service
// -------------------------------------------------------- //
serviceProxy.use(function(req, res, next) {
    if (req._parsedUrl.pathname !== systemConfiguration.proxyUrl) {
        next();
    } else {
        // logging output
        let logline = [];
        let client_ip = req.headers['x-forwarded-for'] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.connection.socket.remoteAddress;
        logline.push((new Date()).toISOString() + " | ");
        logline.push(client_ip + " --");

        let body = [];
        let body_len = 0;

        req.on('data', function(data) {
            body.push(data);
            body_len += data.length;
            if (body_len > systemConfiguration.maxBodySize) {
                // FLOOD ATTACK OR FAULTY CLIENT, NUKE REQUEST
                req.connection.destroy();
                // logging output
                logline.push("[EXCESSIVE UPLOAD TERMINATED] " + body_len + " bytes");
                console.log(logline.join(''));
            }
        });
        req.on('end', function() {
            let headers = {};
            // load the xml send in POST body and extract the redirect URL value
            try {
                const doc_str = String(Buffer.concat(body));
                const xml = new dom().parseFromString(doc_str);
                let domain = xpath.select("//security/domain/text()", xml)[0].toString();
                let usrname = xpath.select("//security/username/text()", xml)[0].toString();
                let proxy_to = xpath.select("//proxy/redirect_url/text()", xml)[0].toString();
                // forward the request to the redirect URL
                proxy_to = new URL(proxy_to);
                let abort = false;
                 _.forEach(req.headers, (value, key) => {
                     // SECURITY: Filter out forbidden headers, needed for i2b2 Java server implementation of SAML2
                     if (ignoreHeaders.find(badHeader => key.toLowerCase() === badHeader.toLowerCase() ) === undefined) {
                         headers[key] = value;
                     } else {
                         // log header injection
                         logline.push('\n\tCLIENT ATTEMPTED TO INJECT FORBIDDEN HEADER "' + key + '" = "' + value + '"');
                         // end the connection
                         abort = true;
                     }
                });
                if (abort) {
                    logline.push('\nTerminating connection with 403\n');
                    console.log(logline.join(''));
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
                // logging output
                logline.push("[" + domain + "/" + usrname + "]--> ");
                logline.push(proxy_to.protocol + "//" + proxy_to.hostname);
                if (opts['port'] === '') {
                    delete opts['port'];
                } else {
                    logline.push(":" + opts['port']);
                }
                logline.push(proxy_to.pathname + " ");

                //Check whitelist
                let hostUrl =  opts.protocol + opts.hostname;
                hostUrl = hostUrl.toUpperCase();

                if (opts.port) {
                    hostUrl = hostUrl + ":" + opts.port;
                }

                let allowedHostUrls  = [];
                if(whitelist && Object.keys(whitelist).length > 0)
                {
                    let protocol = opts.protocol.replace(/:$/, '');
                    whitelist[protocol].forEach(element => allowedHostUrls.push((opts.protocol + element).toUpperCase()));

                    if(!allowedHostUrls.includes(hostUrl)) {
                        let whitelistErr = "Host is not whitelisted: " + hostUrl;
                        logline.push("\n[CODE ERROR] ");
                        logline.push(whitelistErr);
                        console.log(logline.join(''));
                        res.end(whitelistErr);
                        return;
                    }
                }

                let i2b2_result = [];
                const proxy_reqest_hdlr  = function(proxy_res) {
                    logline.push("(" + proxy_res.statusCode + ")");
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
                        logline.push(" SENT");
                        console.log(logline.join(''));
                        res.end(Buffer.concat(i2b2_result));
                    });
                    proxy_res.on('error', (e) => {
                        logline.push("[PROXY HANDLER ERROR]");
                        console.log(logline.join(''));
                        console.error(`problem with response: ${e.message}`);
                        console.dir(e);
                        res.end(Buffer.concat(i2b2_result));
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
                        console.log(logline.join(''));
                        console.error("proxy engine does not support protocol = " + proxy_to.protocol);
                        return false;
                        break;
                }
                proxy_request.on('error', (e) => {
                    logline.push("[PROXY ERROR]");
                    console.log(logline.join(''));
                    console.error(`problem with request: ${e.message}`);
                    console.dir(e);
                    res.end(String(Buffer.concat(i2b2_result)));
                });
                body = String(Buffer.concat(body));
                res.setHeader('i2b2-dev-svr-mode', 'Proxy');
                proxy_request.setHeader('Content-Type', 'text/xml');
                proxy_request.setHeader('Content-Length', body.length);
                proxy_request.end(body);
            } catch(e) {
                logline.push("[CODE ERROR]");
                console.log(logline.join(''));
                console.dir(e);
                res.end("Internal Error Logged");
            }
        })
    }
});


// setup Proxy hosting server
// ======================================================== //
let func_startReporter = function() {
    console.log(proxyConfig.protocol.toUpperCase() + ' Proxy Server running on port ' + proxyConfig.port);
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

console.log(">>>> STARTED " + (new Date()).toISOString() + " <<<<");
