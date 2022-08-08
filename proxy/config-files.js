const fs = require("fs");
const path = require("path");
const express = require("express");
const router = express.Router();

// handle the configuration files
// ---------------------------------------------------------------------------------------------------------------------
let funcConfigFileReader = function(fileList, funcFound, funcNotFound) {
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
    if (found) {
        funcFound(data, file);
    } else {
        funcNotFound();
    }
};


// document the loading locations of the various config files
// ---------------------------------------------------------------------------------------------------------------------
let config_files = {};
let documenter = function(data, file) {
    let loadingFrom;
    if (file.startsWith(configDir)) {
        loadingFrom = "configuration directory of the proxy server. (outside of docker)";
    } else {
        loadingFrom = "hosting directory of the webclient. (within docker)";
    }
    config_files[path.basename(file)] = {
        path: file,
        loading: loadingFrom
    }
};
// for i2b2_config_cells.json
funcConfigFileReader([
        path.join(configDir, 'i2b2_config_cells.json'),
        path.join(hostingDir, 'i2b2_config_cells.json')
    ],
    documenter,
    () => { config_files['i2b2_config_cells.json'] = { error: "was not found!" }; }
);
// for i2b2_config_domains.json
funcConfigFileReader([
        path.join(configDir, 'i2b2_config_domains.json'),
        path.join(hostingDir, 'i2b2_config_domains.json')
    ],
    documenter,
    () => { config_files['i2b2_config_domains.json'] = { error: "was not found!" }; }
);
// for plugins/plugins.json
let pluginsEntry = {};
let pluginsFile = path.join(hostingDir, 'plugins', 'plugins.json');
if (fs.existsSync(pluginsFile)) {
    pluginsEntry.file = pluginsFile;
    pluginsEntry.loading = "static file from directory";
} else {
    pluginsEntry.file = "";
    pluginsEntry.loading = "dynamically generated";
}
config_files['plugins.json'] = pluginsEntry;
// -------------------------------------------------------
// output the config file loading locations
logger.warn({"config_files": config_files}, "Loading locations for config files!");
// -------------------------------------------------------





// =====================================================================================================================
router.get('/i2b2_config_cells.json', (req, res) => {
    funcConfigFileReader(
        [
            path.join(configDir, 'i2b2_config_cells.json'),
            path.join(hostingDir, 'i2b2_config_cells.json')
        ],
        (data) => {
            res.send(data);
        }, ()=> {
            res.sendStatus(404);
        }
    );
});

// =====================================================================================================================
router.get('/i2b2_config_domains.json', (req, res) => {
    funcConfigFileReader(
        [
            path.join(configDir, 'i2b2_config_domains.json'),
            path.join(hostingDir, 'i2b2_config_domains.json')
        ],
        (data) => {
            // override the "urlProxy" property
            let newData = JSON.parse(data);
            newData.urlProxy = systemConfiguration.proxyUrl;
            res.send(JSON.stringify(newData, null, 4));
        }, ()=> {
            res.sendStatus(404);
        }
    );
});

// =====================================================================================================================
router.get('/plugins/plugins.json', (req, res) => {
    let pluginsDir = path.join(hostingDir, 'plugins');
    let outputData = "";
    try {
        // read the existing plugin.json file
        outputData = fs.readFileSync(path.join(pluginsDir, 'plugins.json'));
    } catch (e) {
        // dynamically generate the plugins.json based on directory crawling
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
        walkDir(pluginsDir);
        plugins.forEach((d, i) => {
            plugins[i] = d.replace(pluginsDir + path.sep, '').replaceAll(path.sep, '.');
        });
        outputData = JSON.stringify(plugins);
    }
    res.send(outputData);
});


module.exports = router;