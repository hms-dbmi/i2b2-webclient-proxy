# Deploy *i2b2-webclient-proxy* with i2b2v2 Web Client

## 1) Specify Web Client Version to Use

 Within the `Dockerfile` file look for the following line and change the version number 
 (in this example "`v2.0.0`") to the version number of the web client that you want to run.
 
 ```
 RUN git clone --branch v2.0.0 https://github.com/hms-dbmi/i2b2v2-webclient.git webclient
 ```
 
 You can see a list of available version numbers at [https://github.com/hms-dbmi/i2b2v2-webclient/tags](https://github.com/hms-dbmi/i2b2v2-webclient/tags).

## 2) Setup i2b2 Configuration Files
 You can edit the `i2b2_config_*.json` files that are in the project's `config` subdirectory.  
 Changes to these files will override the default config files that will be downloaded with the i2b2v2 web client.
 
 As a reminder, the `i2b2_config_domains.json` file contains information needed to connect to an i2b2 server.
 The `i2b2_config_cells.json` file contains information on what i2b2 cells (ie components) are going to be loaded 
 and enabled into your i2b2v2 web client deployment. By default, the files given will use the public i2b2 server at `services.i2b2.org`.

 (The default configuration files already present in this repo will create a running instance without needing any changes.)

## 3) Configure the Web Client Proxy Service 

 (The default configuration given in the following fileswill create a running instance without needing any changes.)

 Within the project's `config` subdirectory you will also find a `proxy_settings.json` file that configures operation of the i2b2 proxy service.
 It has the following options:
 
  | Setting Name | Data Type | Description |
  | ------------ |:---------:| ----------- |
  | **`proxyUrl`** | string | URL path that the proxy server operates on, by default it is set to `/~proxy` |  
  | **`useCORS`** | boolean | enable CORS use to allow advanced hosting (_experimental_) |
  | **`proxyToSelfSignedSSL`** | boolean | enables proxy to access i2b2 servers via HTTPS when they are running a self-signed certificate |
  | **`httpsCert`** | string | filename of the HTTPS certificate within the `/config/crypto-keys` directory |
  | **`httpsKey`** | string | filename of the HTTPS private key within the `/config/crypto-keys` directory  |
  | **`maxBodySize`** | integer | maximum request body size (in bytes) that will be accepted by the proxy for forwarding |

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
  
  
## 3) Build the Docker Image

 In the root project folder run the command: 
 ```
 docker build -t i2b2-proxy .
 ```

## 4) Run the Image using Docker-Compose

 In the root project folder run the command:
 ```
 docker-compose -d up
 ```  
 You can run the command without the `-d` option if you wish to see logging displayed live as it is running.
 
#

### Note about Docker mapping of configuration files
> All files in the `/config` subdirectory are volume-mapped into the running Docker image.
> This enables you to change the configuration and/or HTTPS credentials without needing to rebuild the Docker image for each change.
> Although image rebuild is not needed you _will_ need to restart the docker container for changes to be recognized. 
