FROM node:16

WORKDIR /usr/src/i2b2-proxy

# setup the proxy dependencies
COPY package*.json ./
RUN npm install

# copy over the proxy files
COPY . .

ARG I2B2_VERSION
# copy the latest i2b2v2 client
RUN git clone --branch $I2B2_VERSION https://github.com/hms-dbmi/i2b2v2-webclient.git webclient

# open ports for HTTP and HTTPS
EXPOSE 80
EXPOSE 443

ENV REDIRECT_PORT=80
ENV PROXY_PORT=443

# start the proxy
WORKDIR ..
CMD ["node", "/usr/src/i2b2-proxy/proxy/main.js"]
