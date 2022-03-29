FROM node:16

WORKDIR /usr/src/i2b2-proxy

# setup the proxy dependencies
COPY package*.json ./
RUN npm install

# copy over the proxy files
COPY . .

# copy the latest i2b2v2 client
RUN git clone --branch v2.0.0 https://github.com/hms-dbmi/i2b2v2-webclient.git webclient

# open ports for HTTP and HTTPS
EXPOSE 80
EXPOSE 443

# start the proxy
WORKDIR ..
CMD ["node", "/usr/src/i2b2-proxy/proxy/main.js"]
