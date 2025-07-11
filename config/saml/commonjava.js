const baseDir = __dirname + '/config/saml/';
const fs = require('fs');
const path = require('path');

// handle passwords to access the private keys
let keyPasswords = {sigPrivateKey: '', encPrivateKey: ''};
if (process.env.OKTA_SIG_PRIVKEY_PASS) keyPasswords.sigPrivateKey = process.env.OKTA_SIG_PRIVKEY_PASS;
if (process.env.OKTA_ENC_PRIVKEY_PASS) keyPasswords.encPrivateKey = process.env.OKTA_ENC_PRIVKEY_PASS;

module.exports = {
    sp: (req) => {
        const samlURL = req.protocol + '://' + req.get('host') + '/saml/';
        const urlPMService = req.cookies['url'];
        const i2b2Domain = req.cookies['domain'];

        return {
            getMetadata: function() { return 'none'; },
            createLoginRequest: function() {
                return {
                    "id": "something?",
                    "context": "http://dev.commonjava.hms.harvard.edu/service/url"
                };
            },
            parseLoginResponse: function(idp, method, request_info) {
                return Promise((accept, fail) => {
                    // 1) validate session with commonjava
                    if (!ok) {
                        fail(message);
                        return;
                    }

                    // 2) see if user exists on i2b2
                    // use urlPMService & i2b2Domain variables here
                    if (!ok) {
                        fail(message);
                        return;
                    }

                    // 3) create and configure user (only if needed)
                    // use urlPMService & i2b2Domain variables here
                    if (!needed_and_not_ok) {
                        fail(message);
                        return;
                    }

                    // 4) return following data to enable rest of SAML login chain
                    accept({
                        "extract": {
                            // here is a key/value mapping of various session data
                            "nameID": user_eppn,
                            "sessionIndex": {
                                "sessionIndex": commonjava_session
                            }
                        }
                    })
                });
            }
        };
    },
    idp: (req) => {
        return {};
    }
};
