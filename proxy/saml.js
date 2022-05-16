// This is /routes/sso.js
const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const saml = require('samlify');
const ServiceProvider = saml.ServiceProvider;
const IdentityProvider = saml.IdentityProvider;
const fs = require('fs');

// we need to setup a schema validator for this to work
// TODO: Change this to something else?
saml.setSchemaValidator({
    validate: (response) => {
        console.dir(response);
        /* implment your own or always returns a resolved promise to skip */
        return Promise.resolve('skipped');
    }
});



// load our service provider definition
// ============================================
let sp;
try {
    const spFile = "config/saml/_self.xml";
    if (fs.existsSync(spFile)) {
        sp = ServiceProvider({
            metadata: fs.readFileSync(spFile)
        });
    } else {
        console.error("MISSING SERVICE PROVIDER FILE: ./config/saml/_self.xml does not exist");
        process.exit();
    }
} catch(err) {
    console.error("ERROR CHECKING SERVICE PROVIDER FILE: ./config/saml/_self.xml");
    process.exit();
}


// load our identity provider definition(s)
// ============================================
const idpList = {};
fs.readdirSync("config/saml/").forEach((file)=>{
    let parts = file.toLowerCase().split(".");
    if (parts[0] !== "_self" && (parts.length > 1 ? parts[1] === "xml" : false)) {
        idpList[parts[0]] = IdentityProvider({
            metadata: fs.readFileSync("config/saml/" + file),
            isAssertionEncrypted: true,
            messageSigningOrder: 'encrypt-then-sign',
            wantLogoutRequestSigned: true
        });
    }
});


// Release the metadata publicly
// ============================================
router.get('/metadata', (req, res) => res.header('Content-Type','text/xml').send(sp.getMetadata()));
router.get('/idp_list.json', (req, res) => res.json(Object.keys(idpList)));


// Access URL for implementing SP-init SSO
// ============================================
router.get('/redirect/:IdP', (req, res) => {
    const requestedIdP = req.params.IdP.toLowerCase();
    if (idpList[requestedIdP] === undefined) {
        // The requested IdP does not exist
        res.sendStatus(404);
    } else {
        const { id, context } = sp.createLoginRequest(idpList[requestedIdP], 'redirect');
        return res.redirect(context);
    }
});


// If your application only supports IdP-initiated SSO, just make this route is enough
// This is the assertion service url where SAML Response is sent to
router.post('/acs', bodyParser.urlencoded({ extended: false }), (req, res) => {
//router.post('/acs', (req, res) => {
    // decode SAML authentication document
//    const SamlDoc = Buffer.from(req.body.SAMLResponse, 'base64').toString();
    // loop through all known IdPs and search for its "issuer" URL in the document
    for (let idpCode in idpList) {
//        if (SamlDoc.includes(idpList[idpCode].entityMeta.meta.entityID)) {
            sp.parseLoginResponse(idpList[idpCode], 'post', req)
                .then(parseResult => {
                    // TODO: Do side-channel request to start session with PM cell and return Session ID
                    return "THIS-IS-A-TEST-SESSION-ID";
                }).then(sessionId => {
                    let htmlResponse = `<html><body>
                        <script type="text/javascript">window.opener.i2b2.PM.ctrlr.SamlLogin("username", "$[{sessionId}");
                        </body></html>`;
                    res.send(htmlResponse);
                }).catch((e) => {
                debugger;
                console.log(e);
            });
            break;
        //}
    }
});

module.exports = router;

