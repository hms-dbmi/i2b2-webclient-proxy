// This is /routes/sso.js
const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const saml = require('samlify');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// caching of SP and IdP objects
const idpList = {};
// load our identity provider module locations
// ============================================
fs.readdirSync(path.join(path.dirname(__dirname), 'config','saml')).forEach((file)=>{
    let parts = file.toLowerCase().split(".");
    if ((parts.length > 1 ? parts[1] === "js" : false)) {
        idpList[parts[0]] = { module: "../config/saml/" + parts[0] };
    }
});

// loads the service SP and IdP definitions
const func_LoadServiceDef = (service, req) => {
    if (idpList[service] === undefined) return false;
    if (idpList[service].module === undefined) return true;
    const serviceDef = require(idpList[service].module);
    delete idpList[service].module;
    idpList[service].sp = serviceDef.sp(req);
    idpList[service].idp = serviceDef.idp(req);
    return true;
};

// we need to setup a schema validator for this to work
// TODO: Change this to something else?
saml.setSchemaValidator({
    validate: (response) => {
        /* implment your own or always returns a resolved promise to skip */
        return Promise.resolve('skipped');
    }
});


// Release the metadata publicly
// ============================================
router.get('/metadata/:service', (req, res) => {
    const service = req.params.service.toLowerCase();
    if (!func_LoadServiceDef(service, req)) {
        res.sendStatus(404);
        return;
    }
    res.header('Content-Type','text/xml').send(idpList[service].sp.getMetadata());
});

router.get('/idp_list.json', (req, res) => res.json(Object.keys(idpList)));


// Access URL for implementing SP-init SSO
// ============================================
router.get('/redirect/:service', (req, res) => {
    let client_ip = req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress;
    let logline = [];
    logline.push((new Date()).toISOString() + " | ");
    logline.push(client_ip + " --[SAML Redirect]--> ");
    const service = req.params.service.toLowerCase();
    logline.push('(' + service + ')');
    if (!func_LoadServiceDef(service, req)) {
        logline.push(" NOT_CONFIGURED! [ERROR]");
        console.log(logline.join(''));
        res.sendStatus(404);
        return;
    }
    const { id, context } = idpList[service].sp.createLoginRequest(idpList[service].idp, 'redirect');
    logline.push(` ${context.split('?')[0]} [OK]`);
    console.log(logline.join(''));
    return res.redirect(context);
});


// If your application only supports IdP-initiated SSO, just make this route is enough
// This is the assertion service url where SAML Response is sent to
router.post('/acs/:service', bodyParser.urlencoded({ extended: false }), (req, res) => {
    let userID;
    let client_ip = req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress;
    let logline = [];
    logline.push((new Date()).toISOString() + " | ");
    logline.push(client_ip + " --[SAML ACS]--> ");
    const service = req.params.service.toLowerCase();
    logline.push('(' + service + ')');
    if (!func_LoadServiceDef(service, req)) {
        logline.push(" NOT_CONFIGURED! [ERROR]");
        console.log(logline.join(''));
        res.sendStatus(404);
        return;
    }
    // decode SAML authentication document
    idpList[service].sp.parseLoginResponse(idpList[service].idp, 'post', req)
    .then(parseResult => {
        // TODO: Do side-channel request to start session with PM cell and return Session ID
        userID = parseResult.extract.nameID;
        logline.push(" START_SESSION FOR " + userID);
        return new Promise((resolve, reject) => {
            // get the user identifier to be logged in
            const requestData = Object.assign({method: "post", maxRedirects: 0}, proxyConfiguration.i2b2SessionRequest);
            if (requestData.data === undefined) requestData.data = {};
            requestData.data.username = userID;
            requestData.data.clientIP = client_ip;

            // create a session key via protected API request
            logline.push(" VIA " + requestData.url);
            // handle self-signed SSL
            if (proxyConfiguration.proxyToSelfSignedSSL) {
                // Insanely insecure hack to accept self-signed SSL Certificates (if configured)
                process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
            } else {
                process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
            }
            // make request
            axios.request(requestData).then((response) => {
                if (response.status !== 200) {
                    logline.push(" Response=" + response.status + " [ERROR]");
                    console.log(logline.join(''));
                    reject('Server Failed to Generate SessionID');
                } else {
                    logline.push(" [OK]");
                    resolve(response.data.session);
                }
            }).catch((error)=>{
                logline.push(" [HTTP FAILED]");
                reject(error.message);
            });
        });
    }).then(sessionId => {
        let htmlResponse = `<html><body>
        <script type="text/javascript">window.opener.i2b2.PM.ctrlr.SamlLogin("${userID}", "${sessionId}");</script>
        </body></html>`;
        console.log(logline.join(''));
        res.send(htmlResponse);
    }).catch((e) => {
        logline.push(" [PARSING FAILED] [ERROR] " + e);
        console.log(logline.join(''));
        res.sendStatus(401);
    });
});

module.exports = router;

