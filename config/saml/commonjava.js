const baseDir = __dirname + '/config/saml/';
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const commonJavaUrl = 'https://commonjava.catalyst.harvard.edu';

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
                    "id": "HarvardKey",
                    "context": commonJavaUrl
                };
            },
            parseLoginResponse: function(idp, method, request_info) {
                return new Promise(async (accept, fail) => {
                    try {
                        const sessionId = request_info.sessionId;
                        const eppn = request_info.eppn;

                        // 1) Validate session with commonjava
                        const response = await fetch(commonJavaUrl+'/api/isLoggedIn', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Cookie': `JSESSIONID=${sessionId}`
                            },
                            credentials: 'include'
                        });

                        if (!response.ok) {
                            fail(`Session validation failed with status ${response.status}`);
                            return;
                        }

                        const result = await response.json();
                        if (!result.loggedIn || result.user?.eppn !== eppn) {
                            fail("Session is not valid or eppn mismatch.");
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
                                "nameID": eppn,
                                "sessionIndex": {
                                    "sessionIndex": sessionId
                                }
                            }
                        })
                    } catch (err) {
                        console.error("Error validating session:", err);
                        fail("Internal error during session validation");
                    }
                });
            }
        };
    },
    idp: (req) => {
        return {};
    }
};
