const axios = require("axios");

const defaultSettings = {
    method: "post",
    maxRedirects: 0,
    "timeout": 5000
}

const instancesOfCQ2 = {
    "http://weberdemo.hms.harvard.edu/i2b2/CQ2ServiceProxy.php/PMService/": {
        "url": "http://weberdemo.hms.harvard.edu/i2b2/CQ2StartSession.php",
        "secret": "weberlabs!"
    }
};

const getAuthentication = function(url, domain, userID, session_id, client_ip, logging_object) {
    return new Promise((resolve, reject) => {
        const targetCQ2 = instancesOfCQ2[url];
        if (!targetCQ2) reject("Don't have session initialization data");

        // create the request packet
        const requestData = Object.assign({}, defaultSettings, {
            "url": targetCQ2.url,
            "data": {
                "secret": targetCQ2.secret,
                "username": userID,
                "clientIP": client_ip
            }
        });

        // make request
        axios.request(requestData).then((response) => {
            logging_object.response_status = response.status;
            if (response.status !== 200) {
                reject('Server Failed to Generate SessionID');
            } else {
                resolve(response.data.session);
            }
        }).catch((error) => {
            logging_array.push(" [HTTP FAILED]");
            reject(error.message);
        });
    });
};

module.exports = getAuthentication;
