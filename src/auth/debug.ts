import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";
import { URL } from "url";
import { AuthManager } from "./manager";

/**
 * Debug the authentication (token and Home Assistant instance URL) and connection settings
 * @param context Extension context
 */
export async function debugAuthSettings(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("vscode-ha-config");

  // Every source, in the order AuthManager looks them up
  const urlSources: [string, string | undefined][] = [
    ["workspace settings", AuthManager.getWorkspaceSetting("url")],
    ["SecretStorage", await AuthManager.getSecret(context, "url")],
    ["environment", AuthManager.getEnvironment("url")],
    ["user settings (deprecated, migrated to SecretStorage)", AuthManager.getUserSetting("url")],
  ];
  const tokenSources: [string, string | undefined][] = [
    ["workspace settings", AuthManager.getWorkspaceSetting("token")],
    ["SecretStorage", await AuthManager.getSecret(context, "token")],
    ["environment", AuthManager.getEnvironment("token")],
    ["user settings (deprecated, migrated to SecretStorage)", AuthManager.getUserSetting("token")],
  ];
  // The pair actually used: the URL and token always come from the same place
  const activeUrlEntry = await AuthManager.resolve(context, "url");
  const activeTokenEntry = await AuthManager.resolve(context, "token");
  const activeUrl = activeUrlEntry?.value;
  const activeToken = activeTokenEntry?.value;

  // Show results
  const debugPanel = vscode.window.createOutputChannel("Home Assistant Auth Debug");
  debugPanel.clear();
  debugPanel.appendLine("Home Assistant Connection Status:");
  debugPanel.appendLine("---------------------------------");
  debugPanel.appendLine("If the workspace settings set the URL or token, both come from the workspace settings. Otherwise the first source that is set is used: SecretStorage, environment, then user settings.");
  if (!vscode.workspace.isTrusted) {
    debugPanel.appendLine("This workspace isn't trusted, so its settings are ignored.");
  }

  debugPanel.appendLine("\n--- Home Assistant Instance URL --- ");
  for (const [source, value] of urlSources) {
    debugPanel.appendLine(`URL in ${source}: ${value || "Not configured"}`);
  }

  if (activeUrlEntry) {
    debugPanel.appendLine(`Active URL: ${activeUrl}`);
    debugPanel.appendLine(`URL source: ${activeUrlEntry.source}`);
  } else {
    debugPanel.appendLine("No active URL found. Please configure the Home Assistant instance URL.");
  }

  debugPanel.appendLine("\n--- Access Token --- ");
  for (const [source, value] of tokenSources) {
    debugPanel.appendLine(`Token in ${source}: ${value ? "Present" : "Not present"}`);
  }

  // Show token details if available
  if (activeToken && activeTokenEntry) {
    const obscuredToken = activeToken.length <= 10 
      ? "***" 
      : `${activeToken.substring(0, 5)}...${activeToken.substring(activeToken.length - 5)}`;
    debugPanel.appendLine(`Active token (obscured): ${obscuredToken}`);
    debugPanel.appendLine(`Token source: ${activeTokenEntry.source}`);

    // Check token format
    if (activeToken.startsWith("eyJ")) {
      debugPanel.appendLine("Token appears to be in JWT format");
      
      // Decode JWT token to help diagnose issues
      try {
        const payload = JSON.parse(atob(activeToken.split(".")[1]));
        
        if (payload.iat) {
          const creationDate = new Date(payload.iat * 1000);
          debugPanel.appendLine(`Token was created on: ${creationDate.toLocaleString()}`);
        }
        
        if (payload.exp) {
          const expirationDate = new Date(payload.exp * 1000);
          const now = new Date();
          const isExpired = expirationDate < now;
          
          debugPanel.appendLine(`Token ${isExpired ? "expired" : "will expire"} on: ${expirationDate.toLocaleString()}`);
          
          if (isExpired) {
            debugPanel.appendLine("⚠️ WARNING: Token has expired! Please generate a new long-lived access token in Home Assistant.");
          } else {
            // Show days until expiration
            const daysRemaining = Math.round((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            debugPanel.appendLine(`Token valid for approximately ${daysRemaining} more days`);
          }
        } else {
          debugPanel.appendLine("Token does not contain an expiration date (exp claim).");
        }
      } catch (error) {
        debugPanel.appendLine(`Error decoding JWT token: ${error.message}`);
      }
    } else {
      debugPanel.appendLine("Token appears to be a long-lived access token (not JWT format).");
    }
  } else {
    debugPanel.appendLine("No active token found. Please configure the Home Assistant access token.");
  }
  
  debugPanel.appendLine("\n--- Connection Test --- ");
  if (activeUrl && activeToken) {
    debugPanel.appendLine(`Attempting to connect to: ${activeUrl}`);
    
    const ignoreCertificates = config.get<boolean>("ignoreCertificates");
    if (ignoreCertificates) {
      debugPanel.appendLine("Ignoring TLS certificate errors (vscode-ha-config.ignoreCertificates is true).");
    }
    
    try {
      // Remove trailing slashes to prevent double slashes in the path
      const normalizedUrl = activeUrl.replace(/\/+$/, "");
      const parsedUrl = new URL(`${normalizedUrl}/api/`);
      const agent = parsedUrl.protocol === "https:" ? new https.Agent({ rejectUnauthorized: !ignoreCertificates }) : undefined;

      const request = (parsedUrl.protocol === "https:" ? https : http).request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
          method: "GET",
          headers: {
            "Authorization": `Bearer ${activeToken}`,
            "Content-Type": "application/json",
          },
          agent: agent,
        },
        (res) => {
          debugPanel.appendLine(`Connection test status: ${res.statusCode} ${res.statusMessage}`);
          
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          
          res.on("end", () => {
            try {
              const responseJson = JSON.parse(body);
              debugPanel.appendLine(`Response: ${JSON.stringify(responseJson, null, 2)}`);
              if (responseJson.message === "API running.") {
                debugPanel.appendLine("✅ Connection successful! API is running.");
              } else {
                debugPanel.appendLine("❌ Connection successful, but API response was unexpected.");
              }
            } catch (e) {
              debugPanel.appendLine(`Error parsing response as JSON: ${e.message}`);
              debugPanel.appendLine(`Raw response body: ${body}`);
            }
            debugPanel.show();
          });
        }
      );
      
      request.on("error", (err) => {
        debugPanel.appendLine(`❌ Connection error: ${err.message}`);
        if (err.message.includes("CERT_HAS_EXPIRED")) {
          debugPanel.appendLine("Hint: The TLS certificate for your Home Assistant instance may have expired.");
        } else if (err.message.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE")) {
          debugPanel.appendLine("Hint: The TLS certificate for your Home Assistant instance is not trusted. You may need to set `vscode-ha-config.ignoreCertificates` to true in your VS Code settings if you are using a self-signed certificate.");
        } else if (err.message.includes("ENOTFOUND")) {
          debugPanel.appendLine("Hint: The hostname for your Home Assistant instance could not be resolved. Check your DNS settings and the URL.");
        } else if (err.message.includes("ECONNREFUSED")) {
          debugPanel.appendLine("Hint: The connection to your Home Assistant instance was refused. Ensure Home Assistant is running and accessible at the specified URL and port.");
        }
        debugPanel.show();
      });
      
      request.end();
    } catch (error) {
      debugPanel.appendLine(`❌ Error during connection test setup: ${error.message}`);
      debugPanel.show();
    }
  } else if (!activeUrl) {
    debugPanel.appendLine("Cannot perform connection test: Home Assistant instance URL is not configured.");
    debugPanel.show();
  } else {
    debugPanel.appendLine("Cannot perform connection test: Home Assistant access token is not configured.");
    debugPanel.show();
  }
}

/**
 * Test connection to Home Assistant API
 * @param url The URL to connect to
 * @param token The token to use for authentication
 * @param ignoreCertificates Whether to ignore certificate errors
 * @returns Connection test results
 */
export async function testHomeAssistantConnection(
  url: string, 
  token: string, 
  ignoreCertificates: boolean
): Promise<{ success: boolean; message: string; data?: any }> {
  return new Promise((resolve, reject) => {
    try {
      // Remove trailing slashes to prevent double slashes in the path
      const normalizedUrl = url.replace(/\/+$/, "");
      const apiUrl = new URL(`${normalizedUrl}/api/`);
      const options = {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        rejectUnauthorized: !ignoreCertificates
      };
      
      const requestLib = apiUrl.protocol === "https:" ? https : http;
      
      const req = requestLib.request(apiUrl, options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const parsedData = JSON.parse(data);
              
              // Extract version information from the Home Assistant API response
              // The version can be in different locations based on the API
              let version = "unknown";
              if (parsedData.version) {
                // Directly in the version field
                version = parsedData.version;
              } else if (parsedData.ha_version) {
                // Sometimes it's in ha_version
                version = parsedData.ha_version;
              } else if (parsedData.config && parsedData.config.version) {
                // Or nested in config.version
                version = parsedData.config.version;
              } else if (parsedData.message && typeof parsedData.message === "string") {
                // Sometimes it's in a welcome message like "API running. Home Assistant 2022.5.3"
                const versionMatch = parsedData.message.match(/Home Assistant (\d+\.\d+\.\d+)/i);
                if (versionMatch && versionMatch[1]) {
                  version = versionMatch[1];
                }
              }
              
              // If we still don't have the version, try a second call to /api/config
              if (version === "unknown") {
                const configUrl = new URL(`${normalizedUrl}/api/config`);
                const configReq = requestLib.request(configUrl, options, (configRes) => {
                  let configData = "";
                  configRes.on("data", (chunk) => {
                    configData += chunk;
                  });
                  
                  configRes.on("end", () => {
                    if (configRes.statusCode === 200) {
                      try {
                        const configParsedData = JSON.parse(configData);
                        if (configParsedData.version) {
                          version = configParsedData.version;
                        }
                        resolve({ 
                          success: true, 
                          message: "API connection successful", 
                          data: { 
                            ...parsedData,
                            version: version
                          } 
                        });
                      } catch {
                        // If we can't parse the config, just return the original data
                        resolve({ 
                          success: true, 
                          message: "API connection successful", 
                          data: { 
                            ...parsedData,
                            version: version
                          } 
                        });
                      }
                    } else {
                      // If the config API fails, just return the original data
                      resolve({ 
                        success: true, 
                        message: "API connection successful", 
                        data: { 
                          ...parsedData,
                          version: version
                        } 
                      });
                    }
                  });
                });
                
                configReq.on("error", () => {
                  // If the config API request fails, just return the original data
                  resolve({ 
                    success: true, 
                    message: "API connection successful", 
                    data: { 
                      ...parsedData,
                      version: version
                    } 
                  });
                });
                
                configReq.end();
              } else {
                // We already have the version, just return the data
                resolve({ 
                  success: true, 
                  message: "API connection successful", 
                  data: { 
                    ...parsedData,
                    version: version
                  } 
                });
              }
            } catch (e) {
              console.log("Failed to parse JSON response:", e.message);
              resolve({ success: true, message: "API connection successful, but response wasn't valid JSON" });
            }
          } else if (res.statusCode === 401) {
            resolve({ success: false, message: "Authentication failed (401 Unauthorized)" });
          } else {
            resolve({ success: false, message: `HTTP error: ${res.statusCode} ${res.statusMessage}` });
          }
        });
      });
      
      req.on("error", (error) => {
        reject(error);
      });
      
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}
