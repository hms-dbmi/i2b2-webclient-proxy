const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const path = require('path');
const simpleGit = require('simple-git');

if (systemConfiguration.gitManager.repo !== undefined && systemConfiguration.gitManager.password !== undefined) {
    const git = simpleGit(hostingDir);
    const func_checkPassword = (password, response) => {
        if (password === 'Bearer ' + systemConfiguration.gitManager.password) return true;
        response.sendStatus(401); // unauthorized
        return false;
    };

    systemConfiguration.gitManager.repo = systemConfiguration.gitManager.repo.replace(/.git$/i, '');

    router.get('/load/:id', (req, res) => {

        if (!func_checkPassword(req.headers.authorization, res)) return false;

        // this is probably overkill but...
        // now RESET -> CHECKOUT -> FETCH -> PULL
        git.reset('hard', () => {
            git.checkout(req.params.id, () => {
                git.fetch(['--tags', '--force'], () => {
                    git.pull(['--force'], () => {
                        res.sendStatus(200);
                    });
                });
            });
        });
    });

    router.get('/options', (req, res) => {
        let opts = {};
        opts.repo = systemConfiguration.gitManager.repo;
        opts.headName = systemConfiguration.gitManager.headName;
        res.header('Content-Type','application/json').send(opts);
    });


    router.get('/branch', (req, res) => {
        git.branch('-l').then((branches) => {
            res.header('Content-Type','application/json').send(branches);
        }).catch((e) => {
            console.error("ERROR with call to /"+systemConfiguration.gitManager.managerUrl+"/branch");
            console.dir(e);
            res.sendStatus(500);
        });
    });


    router.get('/', (req, res) => {
        res.sendFile(path.join(baseDir,'proxy','git-manager.html'));
    });


    module.exports = router;

}


