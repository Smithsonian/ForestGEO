import React from "react";
import ReactDOM from "react-dom";
import { createTheme, loadTheme, Theme } from "@fluentui/react";

import "./index.css";
import App from "./App";
import { StorageProvider } from "./context/storageContext";
import * as serviceWorkerRegistration from "./serviceWorkerRegistration";
import reportWebVitals from "./reportWebVitals";
import { ConnectivityProvider } from "./context/connectivityContext";

// Fluent UI theme
const appTheme: Theme = createTheme({
  palette: {
    themePrimary: "#096623",
    themeLighterAlt: "#f0f9f2",
    themeLighter: "#c5e7ce",
    themeLight: "#98d1a8",
    themeTertiary: "#4aa363",
    themeSecondary: "#187833",
    themeDarkAlt: "#085c20",
    themeDark: "#074e1b",
    themeDarker: "#053914",
    neutralLighterAlt: "#faf9f8",
    neutralLighter: "#f3f2f1",
    neutralLight: "#edebe9",
    neutralQuaternaryAlt: "#e1dfdd",
    neutralQuaternary: "#d0d0d0",
    neutralTertiaryAlt: "#c8c6c4",
    neutralTertiary: "#a19f9d",
    neutralSecondary: "#605e5c",
    neutralPrimaryAlt: "#3b3a39",
    neutralPrimary: "#323130",
    neutralDark: "#201f1e",
    black: "#000000",
    white: "#ffffff",
  },
});

loadTheme(appTheme);

ReactDOM.render(
  <React.StrictMode>
    <ConnectivityProvider>
      <StorageProvider>
        <App />
      </StorageProvider>
    </ConnectivityProvider>
  </React.StrictMode>,
  document.getElementById("root")
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://cra.link/PWA
serviceWorkerRegistration.register();

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
