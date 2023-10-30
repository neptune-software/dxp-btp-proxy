# Neptune Application Router

This app will be used as proxy to connect to On-premise Neptune


## Pre-requisites

Node LTS (current version Node 18)

https://nodejs.org/en

SAP MBT 

```bash
npm i mbt -g
```

Install MultiApps CF CLI Plugin

```bash
cf add-plugin-repo CF-Community https://plugins.cloudfoundry.org
cf install-plugin multiapps
```

Install DefaultEnv plugin to run approuter local with destinations on Cloud Foundry

```bash
cf install-plugin DefaultEnv
```

## Build and Deploy to Cloud Foundry

```bash
cf login -a https://api.cf.us10-001.hana.ondemand.com/

mbt build -t ./

cf deploy neptune-proxy_1.0.0.mtar
```


## Test the proxy in the browser

UI5 app
https://3b4e2d12trial-dev-neptune-proxy.cfapps.us10-001.hana.ondemand.com/

Northwind Service (No authentication)
https://3b4e2d12trial-dev-neptune-proxy.cfapps.us10-001.hana.ondemand.com/northwind/V4/Northwind/Northwind.svc/

OData Service

https://3b4e2d12trial-dev-neptune-proxy.cfapps.us10-001.hana.ondemand.com/backend/sap/opu/odata/SAP/SEPMRA_PO_APV/PurchaseOrders

https://vhcalnplci:44300/sap/opu/odata/SAP/SEPMRA_PO_APV/PurchaseOrders

## Start the app local with Cloud Foundry Connection





