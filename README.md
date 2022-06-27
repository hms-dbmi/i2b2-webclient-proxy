# Deploy *i2b2-webclient-proxy* with i2b2v2 Web Client

## 1) Setup i2b2 Configuration Files (Optional)
 You can edit the `i2b2_config_*.json` files that are in the project's `config` subdirectory.  
 Changes to these files will override the default config files that will be downloaded with the i2b2v2 web client.
 
 As a reminder, the `i2b2_config_domains.json` file contains information needed to connect to an i2b2 server.
 The `i2b2_config_cells.json` file contains information on what i2b2 cells (ie components) are going to be loaded 
 and enabled into your i2b2v2 web client deployment. By default, the files given will use the public i2b2 server at `services.i2b2.org`.

 *The default configuration files already present in this repo will create a running instance without needing any changes.*

## 2) Configure the Web Client Proxy Service (Optional)

 *The default configuration given in the following files will create a running instance without needing any changes.*

 Within the project's `config` subdirectory you will also find a `proxy_settings.json` file that configures operation of the i2b2 proxy service.
 It has the following options:
 
  | Setting Name | Data Type | Description |
  | ------------ |:---------:| ----------- |
  | **`proxyUrl`** | string | URL path that the proxy server operates on, by default it is set to `/~proxy` |  
  | **`useCORS`** | boolean | Enable CORS use to allow advanced hosting (_experimental_) |
  | **`proxyToSelfSignedSSL`** | boolean | Enables proxy to access i2b2 servers via HTTPS when they are running a self-signed certificate |
  | **`maxBodySize`** | integer | Maximum request body size (in bytes) that will be accepted by the proxy for forwarding |
  | **`useSAML`** | boolean | Should the SAML2 authentication system be enabled. |
  | **`redirection`** | object | Should redirection service be running? Delete to disable. |
  | **`redirection.port`** | integer | This is the network port that the redirection service runs on. Defaults to 80 if not set. |
  | **`proxy`** | object | Object that contains proxy configuration information. |
  | **`proxy.protocol`** | `http` or `https` | What protocol should the proxy use? |
  | **`proxy.port`** | integer | What network port should the proxy operate on? |
  | **`proxy.httpsCert`** | string | Filename of the HTTPS certificate within the `/config/crypto-keys` directory. |
  | **`proxy.httpsKey`** | string | Filename of the HTTPS private key within the `/config/crypto-keys` directory.  |
  | **`proxy.httpsPassphrase`** | string | The passphrase that the private key has been encrypted with. Delete for none. |
  | **`gitManager`** | object | This is the configuration object for the GitManager service.  Delete to disable. |
  | **`gitManager.active`** | boolean | Disable GitManager service while still having configuration saved. |
  | **`gitManager.managerUrl`** | string | URL path that the GitManager service operates on. |
  | **`gitManager.password`** | string | Shared secret password used to secure the GitManager service. |
  | **`gitManager.repo`** | string | URL for the Git repo that GitManager service loads from. |
  | **`gitManager.headName`** | string | This is the default branch that is loaded. It should be "master" or "main". |


Also within the project's `config` subdirectory you will also find a `whitelist.json` file that lists the only hostnames that the proxy will forward for.
It has the following format:
```json
{
  "http": [
    "localhost",
    "services.i2b2.org"
  ],
  "https": [
    "localhost",
    "services.i2b2.org"
  ]
}
```
### Configure the ports for the redirect and proxy servers

The port numbers used for the redirect and proxy servers can be modified in the .env file 

  
## 3) Build the Docker Image
 Specify the version number of the web client that you want to run using the I2B2_VERSION arg.
 In this example, "`v2.0.0`" is the version number of the web client used.
 
 You can see a list of available version numbers at [https://github.com/hms-dbmi/i2b2v2-webclient/tags](https://github.com/hms-dbmi/i2b2v2-webclient/tags).
 
 In the root project folder run the command: 
 ```
 docker build --build-arg I2B2_VERSION=v2.0.0 -t i2b2-proxy .
 ```

## 4) Run the Image using Docker-Compose

 In the root project folder run the command:
 ```
 docker-compose up -d
 ```  
 You can run the command without the `-d` option if you wish to see logging displayed live as it is running.
 
## 5) Go to i2b2 webclient at 

```
https://localhost:443/
```

#

###NOTES About Docker version
These instructions were tested with Docker version 20.10.0

### Note about Docker mapping of configuration files
> All files in the `/config` subdirectory are volume-mapped into the running Docker image.
> This enables you to change the configuration and/or HTTPS credentials without needing to rebuild the Docker image for each change.
> Although image rebuild is not needed you _will_ need to restart the docker container for changes to be recognized. 
