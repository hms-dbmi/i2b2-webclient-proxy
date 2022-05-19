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

// configuration
// ======================================================== //
const baseDir = __dirname.split(path.sep).slice(0,-1).join(path.sep);
const hostingDir = path.join(baseDir, 'webclient');
const configDir = path.join(baseDir, 'config');
const cryptoKeyDir = path.join(configDir, 'crypto-keys');

// read the configuration from "/config/proxy_settings.json"
let data = JSON.parse(fs.readFileSync(path.join(configDir, "proxy_settings.json")));
let whitelist = JSON.parse(fs.readFileSync(path.join(configDir, "whitelist.json")));

// prefix the location of the "crypto-keys" directory to the cert/key filenames given
data.httpsCert = path.join(cryptoKeyDir, data.httpsCert);
data.httpsKey = path.join(cryptoKeyDir, data.httpsKey);
global.proxyConfiguration = data; //<=== accessable in modules too

// HTTP listener that redirects to HTTPS
// ======================================================== //
const functDoRedirect = function(req, res) { res.redirect('https://' + req.headers.host + req.url); };
const httpRedirect = express();
if (proxyConfiguration.useCORS) httpRedirect.use(cors());
httpRedirect.get('*', functDoRedirect);
httpRedirect.post('*', functDoRedirect);
const httpServer = http.createServer(httpRedirect);
let redirPort = process.env.REDIRECT_PORT ? process.env.REDIRECT_PORT : 80;
httpServer.listen(redirPort, () => { console.log('HTTP Redirect Service running on port ' + redirPort); });
// ======================================================== //



// build the proxy service
// ======================================================== //
const httpsProxy = express();
if (proxyConfiguration.useCORS) httpsProxy.use(cors());



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
httpsProxy.get('/i2b2_config_cells.json', (req, res) => {
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
httpsProxy.get('/i2b2_config_domains.json', (req, res) => {
    const files = [
        path.join(configDir, 'i2b2_config_domains.json'),
        path.join(hostingDir, 'i2b2_config_domains.json')
    ];
    funcConfigFileReader(
        files,
        (data) => {
            // override the "urlProxy" property
            let newData = JSON.parse(data);
            newData.urlProxy = proxyConfiguration.proxyUrl;
            res.send(JSON.stringify(newData, null, 4));
        }, ()=> {
            res.sendStatus(404);
        }
    );
});

// -------------------------------------------------------- //
httpsProxy.get('/plugins/plugins.json', (req, res) => {

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
if (proxyConfiguration.useSAML) httpsProxy.use("/saml", require(path.join(baseDir, "proxy", "saml.js")));




// serve the static files
// -------------------------------------------------------- //
httpsProxy.use(express.static(hostingDir));

// proxy service
// -------------------------------------------------------- //
httpsProxy.use(function(req, res, next) {
    if (req._parsedUrl.pathname !== proxyConfiguration.proxyUrl) {
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
            if (body_len > proxyConfiguration.maxBodySize) {
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
                 _.forEach(req.headers, (value, key) => {
                    headers[key] = value;
                });
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
                        if (proxyConfiguration.proxyToSelfSignedSSL) {
                            // Insanely insecure hack to accept self-signed SSL Certificates (if configured)
                            process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
                        } else {
                            process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
                        }
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


// setup SSL
// ======================================================== //
const httpsServer = https.createServer({
    key: fs.readFileSync(proxyConfiguration.httpsKey),
    cert: fs.readFileSync(proxyConfiguration.httpsCert),
}, httpsProxy);

// start proxy
// ======================================================== //
let proxyPort = process.env.PROXY_PORT ? process.env.PROXY_PORT : 443;
httpsServer.listen(proxyPort, () => {
    console.log('HTTPS Proxy Server running on port ' + proxyPort);
});

console.log(">>>> STARTED " + (new Date()).toISOString() + " <<<<");
