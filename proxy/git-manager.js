const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const path = require('path');
const simpleGit = require('simple-git');

if (proxyConfiguration.gitManager.repo !== undefined && proxyConfiguration.gitManager.password !== undefined) {
    const git = simpleGit(hostingDir);
    const func_checkPassword = (password, response) => {
        if (password === 'Bearer ' + proxyConfiguration.gitManager.password) return true;
        response.sendStatus(401); // unauthorized
        return false;
    };

    proxyConfiguration.gitManager.repo = proxyConfiguration.gitManager.repo.replace(/.git$/i, '');

    router.get('/load/:id', (req, res) => {

        if (!func_checkPassword(req.headers.authorization, res)) return false;

        // switch(req.params.type) {
        //     case "tag":
                git.checkout(req.params.id, (results) => {
                    res.sendStatus(200);
                });
        //         break;
        //     default:
        //         res.sendStatus(404);
        // }
    });

    router.get('/options', (req, res) => {
        let opts = {};
        opts.repo = proxyConfiguration.gitManager.repo;
        opts.headName = proxyConfiguration.gitManager.headName;
        res.header('Content-Type','application/json').send(opts);
    });


    router.get('/branch', (req, res) => {
        git.branch('-l').then((branches) => {
            res.header('Content-Type','application/json').send(branches);
        }).catch((e) => {
            console.error("ERROR with call to /"+proxyConfiguration.gitManager.managerUrl+"/branch");
            console.dir(e);
            res.sendStatus(500);
        });
    });


    router.get('/', (req, res) => {
        res.sendFile(path.join(baseDir,'proxy','git-manager.html'));
    });


    module.exports = router;

}


