const axios = require("axios");
const xpath = require("xpath");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");

const generateMessage = function(domain, user, password) {
    let offset = 1000000;
    let msgNum = String(Math.random() * (Number.MAX_SAFE_INTEGER - offset) + offset);
    let msgDateTime = new Date().toISOString();
    return  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <i2b2:request xmlns:i2b2="http://www.i2b2.org/xsd/hive/msg/1.1/" xmlns:pm="http://www.i2b2.org/xsd/cell/pm/1.1/">
            <message_header>
                <i2b2_version_compatible>1.1</i2b2_version_compatible>
                <hl7_version_compatible>2.4</hl7_version_compatible>
                <sending_application><application_name>i2b2 Webclient Proxy</application_name><application_version>2.0</application_version></sending_application>
                <sending_facility><facility_name>i2b2 Hive</facility_name></sending_facility>
                <receiving_application><application_name>Project Management Cell</application_name><application_version>2.0</application_version></receiving_application>
                <receiving_facility><facility_name>i2b2 Hive</facility_name></receiving_facility>
                <datetime_of_message>${msgDateTime}</datetime_of_message>
                <security>
                    <domain>${domain}</domain>
                    <username>${user}</username>
                    <password>${password}</password>
                </security>
                <message_control_id>
                    <message_num>${msgNum}</message_num>
                    <instance_num>0</instance_num>
                </message_control_id>
                <processing_id><processing_id>P</processing_id><processing_mode>I</processing_mode></processing_id>
                <accept_acknowledgement_type>AL</accept_acknowledgement_type>
                <application_acknowledgement_type>AL</application_acknowledgement_type>
                <country_code>US</country_code>
                <project_id></project_id>
            </message_header>
            <request_header><result_waittime_ms>180000</result_waittime_ms></request_header>
            <message_body><pm:get_user_configuration><project></project></pm:get_user_configuration></message_body>
        </i2b2:request>
    `;
};

const getAuthentication = function(url, domain, userID, session_id, client_ip, logging_array) {
    return new Promise((resolve, reject) => {

        let msgBody = generateMessage(domain, userID, session_id);
        let requestData = {
            "url": url + 'getServices',
            "method": "post",
            "maxRedirects": 0,
            "timeout": 60000, // 60 second HTTP timeout
            "headers": {
                "content-type": 'application/xml'
            },
            data: msgBody
        };

        // set the headers for the i2b2 server's SAML auth
        requestData.headers[systemConfiguration.SAML.username.toServer] = userID;
        requestData.headers[systemConfiguration.SAML.session.toServer] = session_id;

        // handle self-signed SSL
        if (systemConfiguration.proxyToSelfSignedSSL) {
            // Insanely insecure hack to accept self-signed SSL Certificates (if configured)
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
        } else {
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
        }

        // make request
        axios.request(requestData).then((response) => {
            if (response.status !== 200) {
                logging_array.push(" Response=" + response.status + " [ERROR]");
                console.log(logging_array.join(''));
                reject('Server Failed to Generate SessionID');
            } else {
                logging_array.push(" [OK]");
                let doc = new DOMParser().parseFromString(response.data, 'text/xml');
                let passNodes = xpath.select("//password/text()", doc);
                let passVal = new XMLSerializer().serializeToString(passNodes[0]);
                resolve(passVal);
            }
        }).catch((error) => {
            logging_array.push(" [HTTP FAILED]");
            reject(error.message);
        });

    });
};


module.exports = getAuthentication;



