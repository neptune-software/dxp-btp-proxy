const axios = require("axios");
const express = require("express");
const passport = require("passport");
const xsenv = require("@sap/xsenv");
const { JWTStrategy, TokenInfo } = require("@sap/xssec");
const tokenCache = require("./tokenCache");

const PORT = process.env.PORT || 4000;
const DESTINATION = process.env.DESTINATION;
const VCAP_SERVICES = JSON.parse(process.env.VCAP_SERVICES);

const app = express();

if (!DESTINATION) {
  console.error("No Destination configured");
}
const iasConfig = xsenv.getServices({ ias: { label: "identity" } }).ias;

passport.use("IAS", new JWTStrategy(iasConfig, "IAS"));

const destSrvCred = VCAP_SERVICES.destination[0].credentials;
const conSrvCred = VCAP_SERVICES.connectivity[0].credentials;

//app.use(passport.initialize());

app.use("/", async function (req, res, next) {
  console.log(">>>>> PKCE begin <<<<<");
  console.log("destinationName=", DESTINATION);
  try {
    const tokenInfo = new TokenInfo(
      req.headers?.authorization?.split("Bearer ")[1] || null
    );

    // If the token is invalid or issued by XSUAA proceed to next middleware
    // Token is not "verified", as it will run through passport before being stored in cache
    if (!tokenInfo.isValid() || tokenInfo.isTokenIssuedByXSUAA()) {
      console.log("not valid");
      return next();
    }

    // Store encoded token value
    const token = tokenInfo.getTokenValue();

    console.log("tokenCache Stats:", tokenCache.getStats());

    // Check if token is cached
    const cachedToken = tokenCache.getToken(token);

    if (cachedToken) {
      // If token is cached, use the cached token and proceed to next middleware
      req.headers["authorization"] = `Bearer ${cachedToken}`;

      console.log("cachedToken is used!");

      return next();
    } else {
      // If token is not cached, authenticate using passport
      passport.authenticate(
        "IAS",
        { session: false, failWithError: true },
        async (err) => {
          console.log("authenticate err:", err);
          try {
            // If error in authentication, send error message
            if (err)
              return res
                .status(err.response?.status || 401)
                .send(`Error: ${err.message}`);

            //console.log("token:" + token);
            // Exchange token
            const exchangedToken = await exchangeToken(token);

            //console.log("exchangedToken:" + exchangedToken);

            // Set the exchanged token in the cache
            tokenCache.setToken(token, exchangedToken);

            // Set the authorization header with the new token
            req.headers["authorization"] = `Bearer ${exchangedToken}`;

            // Proceed to next middleware

            //console.log(">>>>> PKCE end <<<<<");

            return next();
          } catch (err) {
            console.error(err);
            console.error(err.message);
            // If error, send error message with status
            return res
              .status(err.response?.status || 500)
              .send(`Error: ${err.message}`);
          }
        }
      )(req, res, next);
    }
  } catch (err) {
    console.error(err.message);
    // If error, send error message with status
    return res
      .status(err.response?.status || 500)
      .send(`Error: ${err.message}`);
  }
});

app.use("/", async function (req, res) {
  console.log(">>>>> Request begin <<<<<");

  try {
    //app.use(passport.authenticate("JWT", { session: false }));

    const authorization = req.headers.authorization;
    //console.log("authorization=", authorization);

    // call destination service
    const destJwtToken = await _fetchJwtToken(
      destSrvCred.url,
      destSrvCred.clientid,
      destSrvCred.clientsecret
    );

    //console.log("destJwtToken=", destJwtToken);

    const url = req.originalUrl;
    const method = req.method.toLocaleLowerCase();
    const headers = req.headers;

    const destiConfi = await _readDestinationConfig(
      DESTINATION,
      destSrvCred.uri,
      destJwtToken
    );

    //console.log("destiConfi", destiConfi);

    //call onPrem system via connectivity service and Cloud Connector
    const connJwtToken = await _fetchJwtToken(
      conSrvCred.token_service_url,
      conSrvCred.clientid,
      conSrvCred.clientsecret
    );

    const userExchangeToken = await _fetchUserExchangeToken(
      conSrvCred.url,
      conSrvCred.clientid,
      conSrvCred.clientsecret,
      authorization
    );

    const result = await _callOnPrem(
      conSrvCred.onpremise_proxy_host,
      conSrvCred.onpremise_proxy_http_port,
      connJwtToken,
      destiConfi,
      url,
      method,
      headers,
      userExchangeToken
    )
      .then((result) => {
        res.send(result);
      })
      .catch((error) => {
        console.log("error >>>>>>>>>>>>");
        console.log(error);
        console.log("error <<<<<<<<<<<<");
        res
          .status(500)
          .send({ error: "Error occured. Please check log files" });
      });

    //console.log("userExchangeToken=", userExchangeToken);
  } catch (error) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.log(error.response.data);
      console.log(error.response.status);
      console.log(error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      // `error.request` is an instance of XMLHttpRequest in the browser
      // and an instance of http.ClientRequest in node.js
      console.log(error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.log("Error", error.message);
    }
    res.status(400).send(error.message);
  }
});

app.listen(PORT, function () {
  console.log("CloudToOnprem application started on port " + PORT);
});

const _fetchJwtToken = async function (oauthUrl, oauthClient, oauthSecret) {
  return new Promise((resolve, reject) => {
    const tokenUrl =
      oauthUrl +
      "/oauth/token?grant_type=client_credentials&response_type=token";
    const config = {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(oauthClient + ":" + oauthSecret).toString("base64"),
      },
    };
    axios
      .get(tokenUrl, config)
      .then((response) => {
        resolve(response.data.access_token);
      })
      .catch((error) => {
        reject(error);
      });
  });
};

const _fetchUserExchangeToken = async function (
  oauthUrl,
  oauthClient,
  oauthSecret,
  authorization
) {
  return new Promise((resolve, reject) => {
    const access_token = authorization.replace("Bearer ", "");

    const url = oauthUrl + "/oauth/token";
    const data = new URLSearchParams();
    data.append("client_id", oauthClient);
    data.append("client_secret", oauthSecret);
    data.append("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
    data.append("token_format", "jwt");
    data.append("response_type", "token");
    data.append("assertion", access_token);

    axios
      .post(url, data, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
      })
      .then((response) => {
        //console.log("Response:", response.data);
        resolve(response.data.access_token);
      })
      .catch((error) => {
        //console.error("Error:", error);
        reject(error);
      });
  });
};

// Call Destination Service. Result will be an object with Destination Configuration info
const _readDestinationConfig = async function (
  destinationName,
  destUri,
  jwtToken
) {
  return new Promise((resolve, reject) => {
    const destSrvUrl =
      destUri + "/destination-configuration/v1/destinations/" + destinationName;
    const config = {
      headers: {
        Authorization: "Bearer " + jwtToken,
      },
    };
    axios
      .get(destSrvUrl, config)
      .then((response) => {
        resolve(response.data.destinationConfiguration);
      })
      .catch((error) => {
        reject(error);
      });
  });
};

const _callOnPrem = async function (
  connProxyHost,
  connProxyPort,
  connJwtToken,
  destiConfi,
  url,
  method,
  headers,
  userExchangeToken
) {
  return new Promise((resolve, reject) => {
    const targetUrl = destiConfi.URL + url;
    const encodedUser = Buffer.from(
      destiConfi.User + ":" + destiConfi.Password
    ).toString("base64");

    const config = {
      method: method,
      url: targetUrl,
    };

    //if (process.env.NODE_ENV === "production") {
    config.headers = {
      //Authorization: "Basic " + encodedUser,
      "x-requested-with": headers["x-requested-with"],
      NeptuneLaunchpad: headers.neptunelaunchpad,
      NeptuneServer: headers.neptuneserver,
      "Proxy-Authorization": "Bearer " + userExchangeToken,
      "SAP-Connectivity-SCC-Location_ID": destiConfi.CloudConnectorLocationId,
    };
    if (headers["sap-client"]) {
      config.headers["sap-client"] = headers["sap-client"];
    }
    config.proxy = {
      host: connProxyHost,
      port: connProxyPort,
    };
    // } else {
    //   config.headers = {
    //     Authorization: "Basic " + encodedUser,
    //   };
    //   config.httpsAgent = new https.Agent({
    //     rejectUnauthorized: false,
    //   });
    // }

    //console.log("config", config);

    axios(config)
      .then((response) => {
        resolve(response.data);
      })
      .catch((error) => {
        reject(error);
      });
  });
};

/**
 * Exchanges a given token for an SAP IAS ID token.
 *
 * @param {string} token - The JWT token to exchange.
 * @return {Promise<string>} The ID token returned by the server.
 * @throws {Error} If an error occurs during the token exchange.
 */
async function exchangeToken(token) {
  console.log("iasConfig:", iasConfig);

  try {
    // Prepare the options for the POST request
    const options = {
      method: "POST",
      url: `${iasConfig.url}/oauth2/token`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: new URLSearchParams({
        // Use the JWT Bearer grant type for the OAuth2 token request
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        client_id: iasConfig.clientid,
        client_secret: iasConfig.clientsecret,
        response_type: "token+id_token",

        // If the token is a Bearer token, remove the "Bearer " prefix
        assertion: token.split("Bearer ")[1] || token,
      }),
      // httpsAgent: new https.Agent({
      //   // Use the configured certificate and key for the HTTPS agent
      //   cert: iasConfig.certificate,
      //   key: iasConfig.key,
      // }),
    };

    //console.log(options);

    // Make the POST request and wait for the response
    const response = await axios(options);

    console.log("id_token:", response.data?.id_token);

    // Return the ID token from the response
    return response.data?.id_token;
  } catch (err) {
    // Log the error message and re-throw the error
    console.error(err.message);
    throw err;
  }
}
