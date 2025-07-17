const baseDir = __dirname + '/config/saml/';
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const {v4: uuidv4} = require('uuid');
const moment = require('moment');
const {parseStringPromise} = require('xml2js');

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
                        // Validate SAML attributes
                        const { eppn, sessionId, displayName, email: userEmail } = req.body;
                        if (!eppn || !sessionId) {
                            return fail('Missing required SAML attributes: eppn and sessionId');
                        }

                        const userName = eppn.split('@')[0];
                        const fullName = displayName || userName;
                        const email = userEmail || `${userName}@harvard.edu`;
                        const domain = i2b2Domain;
                        const projectId = 'Demo';

                        // Log SAML response for debugging
                        console.log(`SAML Response: eppn=${eppn}, sessionId=${sessionId}, displayName=${displayName}`);

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
                            return fail(`Session validation failed with status ${response.status}`);
                        }

                        const result = await response.json();
                        if (!result.loggedIn || result.user?.eppn !== eppn) {
                            return fail("Session is not valid or eppn mismatch.");
                        }
                        const now = moment().format();
                        const logXml = (label, xml) => console.log(`\n[XML - ${label}]\n${xml}\n`);

                        const generateMessageHeader = (token) => `
                            <message_header>
                                <proxy><redirect_url>${urlPMService}getServices</redirect_url></proxy>
                                <i2b2_version_compatible>1.1</i2b2_version_compatible>
                                <hl7_version_compatible>2.4</hl7_version_compatible>
                                <sending_application><application_name>i2b2 Project Management</application_name><application_version>1.6</application_version></sending_application>
                                <sending_facility><facility_name>i2b2 Hive</facility_name></sending_facility>
                                <receiving_application><application_name>Project Management Cell</application_name><application_version>1.6</application_version></receiving_application>
                                <receiving_facility><facility_name>i2b2 Hive</facility_name></receiving_facility>
                                <datetime_of_message>${now}</datetime_of_message>
                                <security><domain>${domain}</domain><username>i2b2</username><password${token.includes('SessionKey') ? ' is_token="true" token_ms_timeout="1800000"' : ''}>${token}</password></security>
                                <message_control_id><message_num>${uuidv4()}</message_num><instance_num>0</instance_num></message_control_id>
                                <processing_id><processing_id>P</processing_id><processing_mode>I</processing_mode></processing_id>
                                <accept_acknowledgement_type>AL</accept_acknowledgement_type>
                                <application_acknowledgement_type>AL</application_acknowledgement_type>
                                <country_code>US</country_code>
                                <project_id>${projectId}</project_id>
                            </message_header>`;

                        const wrapXml = (header, body) => `
                            <i2b2:request xmlns:i2b2="http://www.i2b2.org/xsd/hive/msg/1.1/" xmlns:pm="http://www.i2b2.org/xsd/cell/pm/1.1/">
                                ${header}
                                <request_header><result_waittime_ms>180000</result_waittime_ms></request_header>
                                <message_body>${body}</message_body>
                            </i2b2:request>`;

                        const wrapWithSoapEnvelope = (i2b2Xml) => `
                            <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                                              xmlns:i2b2="http://www.i2b2.org/xsd/hive/msg/1.1/"
                                              xmlns:pm="http://www.i2b2.org/xsd/cell/pm/1.1/">
                                <soapenv:Header/>
                                <soapenv:Body>
                                    ${i2b2Xml}
                                </soapenv:Body>
                            </soapenv:Envelope>`;

                        const postXml = async (label, xmlBody) => {
                            logXml(label, xmlBody);
                            const res = await fetch(urlPMService, {
                                method: 'POST',
                                headers: {'Content-Type': 'application/xml', 'SOAPAction': ''},
                                body: xmlBody
                            });
                            const responseText = await res.text();
                            logXml(`${label} RESPONSE`, responseText);
                            if (!res.ok) {
                                return fail(`${label} failed: HTTP ${res.status}`);
                            }

                            const parsed = await parseStringPromise(responseText);
                            const status = parsed?.['i2b2:response']?.message_body?.[0]?.['response_status']?.[0]?.['status']?.[0]?.['$']?.['type'];
                            if (status !== 'DONE') {
                                return fail(`${label} failed: status = ${status}`);
                            }
                        };

                        // Step 1: Login
                        const loginXml = wrapXml(generateMessageHeader('demouser'), `
                            <pm:get_user_configuration>
                                <project>${projectId}</project>
                            </pm:get_user_configuration>`);

                        logXml("LOGIN REQUEST", loginXml);
                        const loginRes = await fetch(urlPMService, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/xml',
                                'SOAPAction': 'http://www.i2b2.org/xsd/cell/pm/1.1/get_user_configuration' // You can also try just '""' or omit this entirely depending on endpoint config
                            },
                            body: loginXml
                        });

                        const loginText = await loginRes.text();
                        logXml("LOGIN RESPONSE", loginText);
                        const loginParsed = await parseStringPromise(loginText);
                        const sessionKey = loginParsed?.['i2b2:response']?.message_body?.[0]?.configure?.[0]?.user?.[0]?.password?.[0];
                        if (!sessionKey) return fail("Session key not found in login response.");
                        const token = `SessionKey:${sessionKey}`;

                        // Step 2: Provision user
                        await postXml('CREATE USER', wrapXml(generateMessageHeader(token), `
                            <pm:set_user>
                                <user_name>${userName}</user_name>
                                <full_name>${fullName}</full_name>
                                <email>${email}</email>
                                <is_admin>false</is_admin>
                                <password>password</password>
                            </pm:set_user>`));

                        // Step 3: Assign USER role
                        await postXml('ASSIGN USER ROLE', wrapXml(generateMessageHeader(token), `
                            <pm:set_role>
                                <user_name>${userName}</user_name>
                                <role>USER</role>
                                <project_id>${projectId}</project_id>
                            </pm:set_role>`));

                        // Step 4: Assign DATA_PROT role
                        await postXml('ASSIGN DATA_PROT ROLE', wrapXml(generateMessageHeader(token), `
                            <pm:set_role>
                                <user_name>${userName}</user_name>
                                <role>DATA_PROT</role>
                                <project_id>${projectId}</project_id>
                            </pm:set_role>`));

                        // Step 5: Set authentication method to SAML
                        await postXml('SET AUTH METHOD', wrapXml(generateMessageHeader(token), `
                            <pm:set_user_param>
                                <user_name>${userName}</user_name>
                                <param datatype="T" name="authentication_method">SAML</param>
                            </pm:set_user_param>`));

                        // Success response
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