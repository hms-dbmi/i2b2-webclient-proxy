const baseDir = __dirname + '/config/saml/';
const saml = require('samlify');
const ServiceProvider = saml.ServiceProvider;
const IdentityProvider = saml.IdentityProvider;
const fs = require('fs');
const path = require('path');

// handle passwords to access the private keys
let keyPasswords = {sigPrivateKey: '', encPrivateKey: ''};
if (process.env.OKTA_SIG_PRIVKEY_PASS) keyPasswords.sigPrivateKey = process.env.OKTA_SIG_PRIVKEY_PASS;
if (process.env.OKTA_ENC_PRIVKEY_PASS) keyPasswords.encPrivateKey = process.env.OKTA_ENC_PRIVKEY_PASS;

module.exports = {
    sp: (req) => {
        const samlURL = req.protocol + '://' + req.get('host') + '/saml/';
        return saml.ServiceProvider({
            entityID: samlURL + 'metadata/okta',
            authnRequestsSigned: true,
            wantAssertionsSigned: true,
            wantMessageSigned: true,
            wantLogoutResponseSigned: true,
            wantLogoutRequestSigned: true,
            // the private key (.pem) use to sign the assertion;
            privateKey: fs.readFileSync(path.join(__dirname, 'okta-sig.key')),
            privateKeyPass: keyPasswords.sigPrivateKey,
            // the private key (.pem) use to encrypt the assertion;
            encPrivateKey: fs.readFileSync(path.join(__dirname, 'okta-encrypt.key')),
            encPrivateKeyPass: keyPasswords.encPrivateKey,
            isAssertionEncrypted: true,
            assertionConsumerService: [{
                Binding: saml.Constants.namespace.binding.post,
                Location: samlURL + '/acs/okta'
            }]
        });
    },
    idp: (req) => {
        return saml.IdentityProvider({
            metadata: fs.readFileSync(path.join(__dirname, 'okta.xml')),
            isAssertionEncrypted: true,
            messageSigningOrder: 'encrypt-then-sign',
            wantLogoutRequestSigned: true
        })
    }
};
