const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const saml = require('samlify');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const url = require('url');

const cookieParser = require('cookie-parser');
router.use(cookieParser());


// caching of SP and IdP objects
const idpList = {};
// load our identity provider module locations
// ============================================
const dirConfigSaml = path.join(global.configDir, 'saml');
fs.readdirSync(dirConfigSaml).forEach((file)=>{
    let parts = file.toLowerCase().split(".");
    if ((parts.length > 1 ? parts[1] === "js" : false)) {
        idpList[parts[0]] = { module: path.join(dirConfigSaml, parts[0]) };
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


// List of SAML authenticators
// ============================================
router.get('/idp_list.json', (req, res) => res.json(Object.keys(idpList)));


// Access URL for implementing SP-init SSO
// ============================================
router.get('/redirect/:service', (req, res) => {
    let client_ip = req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress;

    const service = req.params.service.toLowerCase();
    let logline = {
        "date": (new Date()).toISOString(),
        "client_ip": client_ip,
        "SAML": "redirect",
        "service": service,
    };
    if (!func_LoadServiceDef(service, req)) {
        logger.error(logline, "SERVICE NOT_CONFIGURED!");
        res.sendStatus(404);
        return;
    }
    const { id, context } = idpList[service].sp.createLoginRequest(idpList[service].idp, 'redirect');
    logger.info(logline,`${context.split('?')[0]} [OK]`);
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
    const service = req.params.service.toLowerCase();
    let logline = {
        "date": (new Date()).toISOString(),
        "client_ip": client_ip,
        "SAML": "acs",
        "service": service,
    };
    if (!func_LoadServiceDef(service, req)) {
        logger.error(logline, "SERVICE NOT_CONFIGURED!");
        res.sendStatus(404);
        return;
    }

    // get the PM service URL that the user is logging into
    let urlPMService = req.cookies['url'];
    let i2b2Domain = req.cookies['domain'];

    // TODO: Throw error here to browser if there is no cookies to use
    if ([urlPMService, i2b2Domain].includes(undefined)) {
        res.status(408);
        res.setHeader('content-type', 'text/plain');
        res.end("Cookie expired! Try login again.");
        return;
    }

    // check the whitelist
    if (!inWhitelist(urlPMService)) {
        logline.request_headers = req.headers;
        logline.request_body = req.body;
        logline.errorMsg = "Host is not whitelisted: " + urlPMService;
        logger.error(logline, 'Request to non-whitelisted host');
        res.status(403);
        res.setHeader('content-type', 'text/plain');
        res.end("Host is not whitelisted: " + encodeURIComponent(urlPMService));
        return;
    }

    // decode SAML authentication document
    idpList[service].sp.parseLoginResponse(idpList[service].idp, 'post', req)
    .then(parseResult => {
        // TODO: Do side-channel request to start session with PM cell and return Session ID
        userID = parseResult.extract[systemConfiguration.SAML.username.fromSAML];
        logline.userID = userID;

        // get the session from the SAML Assersion
        session_id = parseResult.extract?.sessionIndex.sessionIndex;
        // should we generate our own session identifier?
        if (systemConfiguration.SAML?.session.autogenerate) {
            session_id = Math.random().toString(36).substring(2);
            session_id = session_id + Math.random().toString(36).substring(2);
            session_id = session_id + Math.random().toString(36).substring(2);
            session_id = session_id + Math.random().toString(36).substring(2);
        } else {
            // get the Shibboleth session identifier if configured
            try {
                // only if found (prevents "undefined"s)
                if (parseResult.extract[systemConfiguration.SAML.session.fromSAML]) {
                    session_id = parseResult.extract[systemConfiguration.SAML.session.fromSAML];
                }
            } catch(e) {}
        }

        let promiseGenerator;
        const SamlEngine = String(systemConfiguration.SAML?.type).toUpperCase();
        logline.SAML_engine = SamlEngine;
        switch(SamlEngine) {
            case "I2B2":
                promiseGenerator = require('./saml-session-i2b2.js');
                break;
            case "CQ2":
                promiseGenerator = require('./saml-session-CQ2.js');
                break;
            default:
                logger.error(logline, "[CONFIG ERROR] Invalid SAML.type");
                throw new Error("SAML.type is incorrect or not defined");
                break;
        }
        return promiseGenerator(urlPMService, i2b2Domain, userID, session_id, client_ip, logline);
    }).then(sessionId => {
        let htmlResponse = `<html><body>
        <script type="text/javascript">window.opener.i2b2.PM.ctrlr.SamlLogin("${userID}", "${sessionId}");</script>
        </body></html>`;
        logger.info(logline, "SAML Authenticated");
        res.send(htmlResponse);
    }).catch((e) => {
        logline.error = e;
        logger.info(logline, "[PARSING FAILED] [ERROR]");
        res.sendStatus(401);
    });
});

module.exports = router;

