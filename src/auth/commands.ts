import * as vscode from "vscode";
import { AuthManager } from "./manager";

/**
 * Command to manage the Home Assistant authentication (token and instance URL)
 */
export async function manageAuth(context: vscode.ExtensionContext): Promise<void> {
  const actions = [
    "Set Home Assistant Instance URL",
    "Set Token",
    "Clear Token",
    "Clear Home Assistant Instance URL",
    "View Auth Details (Obscured)",
    "Test Connection",
  ];
  
  const selectedAction = await vscode.window.showQuickPick(actions, {
    placeHolder: "Select an authentication action"
  });
  
  if (!selectedAction) {
    return;
  }
  
  switch (selectedAction) {
    case "Set Home Assistant Instance URL":
      await setInstanceUrl(context);
      break;
    case "Set Token":
      await setToken(context);
      break;
    case "Clear Token":
      await clearToken(context);
      break;
    case "Clear Home Assistant Instance URL":
      await clearInstanceUrl(context);
      break;
    case "View Auth Details (Obscured)":
      await viewAuthDetails(context);
      break;
    case "Test Connection": 
      await testConnection(context);
      break;
  }
}

async function setToken(context: vscode.ExtensionContext): Promise<void> {
  // This sets the stored credentials, which a workspace with its own connection doesn't use
  if (AuthManager.usesWorkspaceCredentials()) {
    const openSettings = "Open Workspace Settings";
    const changeStored = "Change Stored Credentials";
    const choice = await vscode.window.showWarningMessage(
      "This workspace sets its own Home Assistant connection in its settings, so a stored token isn't used here. Change vscode-ha-config.hostUrl and vscode-ha-config.longLivedAccessToken in the workspace settings instead, or change the stored credentials used by other workspaces.",
      { modal: true },
      openSettings,
      changeStored,
    );
    if (choice === openSettings) {
      await vscode.commands.executeCommand("workbench.action.openWorkspaceSettings", {
        query: "vscode-ha-config",
      });
      return;
    }
    if (choice !== changeStored) {
      return;
    }
  }

  // The URL the token will be stored with: the stored one, never a workspace setting, so the
  // stored URL and token always belong to the same instance
  const currentUrl = (await AuthManager.resolveShared(context, "url"))?.value;
  const storedUrl = await AuthManager.getSecret(context, "url");
  
  // Always ask for the instance URL for verification
  const instanceUrl = await vscode.window.showInputBox({
    prompt: "Enter your Home Assistant instance URL",
    placeHolder: "http://homeassistant.local:8123",
    value: currentUrl || "http://homeassistant.local:8123", // Pre-fill default if currentUrl is empty
    validateInput: (input) => {
      // Basic URL validation
      try {
        if (!input) {
          return "Home Assistant instance URL is required";
        }
        
        const url = new URL(input);
        if (!url.protocol.startsWith("http")) {
          return "URL must start with http:// or https://";
        }
        
        return null; // Valid input
      } catch {
        return "Please enter a valid URL (e.g., http://homeassistant.local:8123)";
      }
    }
  });
  
  // User canceled the instance URL input
  if (!instanceUrl) {
    return;
  }
  
  // Save the instance URL with the token, unless it's already the stored one
  if (instanceUrl !== storedUrl) {
    try {
      // Store in SecretStorage
      await AuthManager.storeUrl(context, instanceUrl);
      
      // Remove from settings if it exists
      const config = vscode.workspace.getConfiguration("vscode-ha-config");
      if (config.get("hostUrl") !== undefined) {
        await config.update("hostUrl", undefined, vscode.ConfigurationTarget.Global);
      }
      
      vscode.window.showInformationMessage(`Home Assistant instance URL has been securely stored: ${instanceUrl}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to store Home Assistant instance URL: ${error.message}`);
      return; // Don't proceed to token if URL failed
    }
  }

  const token = await vscode.window.showInputBox({
    prompt: "Enter your Home Assistant Long-Lived Access Token",
    password: true,
    placeHolder: "eyJhbGci..."
  });
  
  if (token) {
    try {
      await AuthManager.storeToken(context, token);
      // Remove from settings if it exists
      const config = vscode.workspace.getConfiguration("vscode-ha-config");
      if (config.get("longLivedAccessToken") !== undefined) {
        await config.update("longLivedAccessToken", undefined, vscode.ConfigurationTarget.Global);
      }
      vscode.window.showInformationMessage("Home Assistant token has been securely stored.");
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to store token: ${error.message}`);
    }
  } else {
    vscode.window.showWarningMessage("No token was entered.");
  }
}

async function clearToken(context: vscode.ExtensionContext): Promise<void> {
  const confirmation = await vscode.window.showWarningMessage(
    "Are you sure you want to clear the stored Home Assistant token?",
    { modal: true },
    "Yes"
  );
  
  if (confirmation === "Yes") {
    try {
      await AuthManager.deleteToken(context);
      vscode.window.showInformationMessage("Home Assistant token has been cleared.");
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to clear token: ${error.message}`);
    }
  }
}

async function viewAuthDetails(context: vscode.ExtensionContext): Promise<void> {
  const { token: resolvedToken, url: resolvedUrl } =
    await AuthManager.resolveConnection(context);
  const token = resolvedToken?.value;
  const url = resolvedUrl?.value;

  if (token || url) {
    let message = "Current Home Assistant Authentication Details:\n";
    if (url) {
      message += `\nHome Assistant Instance URL: ${url} (from ${resolvedUrl?.source})`;
    } else {
      message += "\nHome Assistant Instance URL: Not set";
    }
    if (token) {
      const obscuredToken = token.length <= 10
        ? "***"
        : `${token.substring(0, 5)}...${token.substring(token.length - 5)}`;
      message += `\nToken: ${obscuredToken} (from ${resolvedToken?.source})`;
    } else {
      message += "\nToken: Not set";
    }
    vscode.window.showInformationMessage(message, { modal: true });
  } else {
    vscode.window.showInformationMessage("No Home Assistant token or instance URL is currently stored.");
  }
}

export async function testConnection(context: vscode.ExtensionContext): Promise<void> {
  const connection = await AuthManager.resolveConnection(context);
  const token = connection.token?.value;
  const hostUrl = connection.url?.value;

  // A workspace with its own connection is fixed in its settings, not the stored credentials
  if (AuthManager.usesWorkspaceCredentials() && (!hostUrl || !token)) {
    AuthManager.showIncompleteWorkspaceCredentials();
    return;
  }

  if (!hostUrl) {
    vscode.window.showErrorMessage(
      "Home Assistant instance URL is not set. Please set it first."
    );
    // Optionally, prompt to set it now
    const setNow = await vscode.window.showQuickPick(["Set Home Assistant Instance URL Now"], {
      placeHolder: "Home Assistant instance URL is missing",
    });
    if (setNow === "Set Home Assistant Instance URL Now") {
      await setInstanceUrl(context);
      // Re-check after attempting to set
      const newHostUrl = await AuthManager.getUrl(context);
      if (!newHostUrl) {
        return; // User cancelled or failed to set
      }
      // If token is also missing, prompt for that too or guide user
      if (!token) {
        vscode.window.showInformationMessage("Home Assistant instance URL set. Now please ensure your token is also set via the 'Set Token' command.");
        return;
      }
      // If both are now set, continue with the test
      await testConnection(context);
    }
    return;
  }
  
  if (!token) {
    vscode.window.showErrorMessage(
      "Home Assistant token is not set. Please set it first."
    );
    // Optionally, prompt to set it now
    const setNow = await vscode.window.showQuickPick(["Set Token Now"], {
      placeHolder: "Token is missing",
    });
    if (setNow === "Set Token Now") {
      await setToken(context); 
      // Re-check after attempting to set
      const newToken = await AuthManager.getToken(context);
      if (!newToken) {
        return; // User cancelled or failed to set
      }
      // If token is now set, continue with the test
      await testConnection(context); 
    }
    return;
  }
  
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Testing Home Assistant Connection",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ increment: 0, message: "Connecting..." });
      
      try {
        const response = await fetch(`${hostUrl}/api/`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        
        progress.report({ increment: 50, message: "Validating response..." });
        
        if (response.ok) {
          const data: any = await response.json(); // Add type assertion to any
          if (data.message === "API running.") {
            progress.report({ increment: 100, message: "Connection successful!" });
            vscode.window.showInformationMessage(
              `Successfully connected to Home Assistant at ${hostUrl}. API is running.`
            );
          } else {
            progress.report({ increment: 100, message: "Connection failed." });
            vscode.window.showErrorMessage(
              `Connected to Home Assistant at ${hostUrl}, but API response was unexpected: ${data.message || "No message"}`
            );
          }
        } else {
          progress.report({ increment: 100, message: "Connection failed." });
          let errorMessage = `Failed to connect to Home Assistant at ${hostUrl}. Status: ${response.status} ${response.statusText}`;
          try {
            const errorBody: any = await response.json(); // Add type assertion to any
            if (errorBody && errorBody.message) {
              errorMessage += ` - ${errorBody.message}`;
            }
          } catch {
            // Ignore if error body is not JSON or doesn't have message
          }
          vscode.window.showErrorMessage(errorMessage);
        }
      } catch (error) {
        progress.report({ increment: 100, message: "Connection error." });
        vscode.window.showErrorMessage(
          `Error connecting to Home Assistant at ${hostUrl}: ${error.message}`
        );
      }
    }
  );
}

async function setInstanceUrl(context: vscode.ExtensionContext): Promise<void> {
  // This changes the stored URL, never a workspace setting
  const currentUrl = (await AuthManager.resolveShared(context, "url"))?.value;
  const storedUrl = await AuthManager.getSecret(context, "url");
  
  const newUrl = await vscode.window.showInputBox({
    prompt: "Enter your Home Assistant instance URL",
    placeHolder: "http://homeassistant.local:8123",
    value: currentUrl || "http://homeassistant.local:8123", // Pre-fill default if currentUrl is empty
    validateInput: (input) => {
      // Basic URL validation
      try {
        if (!input) {
          return "Home Assistant instance URL is required";
        }
        
        const url = new URL(input);
        if (!url.protocol.startsWith("http")) {
          return "URL must start with http:// or https://";
        }
        
        return null; // Valid input
      } catch {
        return "Please enter a valid URL (e.g., http://homeassistant.local:8123)";
      }
    }
  });
  
  if (newUrl && newUrl !== storedUrl) {
    try {
      await AuthManager.storeUrl(context, newUrl);
      // Remove from settings if it exists
      const config = vscode.workspace.getConfiguration("vscode-ha-config");
      if (config.get("hostUrl") !== undefined) {
        await config.update("hostUrl", undefined, vscode.ConfigurationTarget.Global);
      }
      vscode.window.showInformationMessage(
        AuthManager.usesWorkspaceCredentials()
          ? `Home Assistant instance URL has been securely stored: ${newUrl}. This workspace sets its own connection in its settings, so it keeps using that.`
          : `Home Assistant instance URL has been securely stored: ${newUrl}`,
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to store Home Assistant instance URL: ${error.message}`);
    }
  } else if (!newUrl) {
    vscode.window.showWarningMessage("No Home Assistant instance URL was entered.");
  } else {
    vscode.window.showInformationMessage("Home Assistant instance URL is already up to date.");
  }
}

async function clearInstanceUrl(context: vscode.ExtensionContext): Promise<void> {
  const confirmation = await vscode.window.showWarningMessage(
    "Are you sure you want to clear the stored Home Assistant instance URL?",
    { modal: true },
    "Yes"
  );

  if (confirmation === "Yes") {
    try {
      await AuthManager.deleteUrl(context);
      vscode.window.showInformationMessage("Home Assistant instance URL has been cleared.");
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to clear Home Assistant instance URL: ${error.message}`);
    }
  }
}
