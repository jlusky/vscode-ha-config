import * as vscode from "vscode";
import { AuthManager } from "./manager";
import { testHomeAssistantConnection } from "./debug";

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
  
  // Ask for the token before storing anything, so cancelling leaves the stored pair unchanged
  const token = await vscode.window.showInputBox({
    prompt: "Enter your Home Assistant Long-Lived Access Token",
    password: true,
    placeHolder: "eyJhbGci..."
  });

  if (!token) {
    vscode.window.showWarningMessage("No token was entered. The stored URL and token are unchanged.");
    return;
  }

  // Store the URL and token together. If the token can't be stored, put the previous URL
  // back, so the old token is never left paired with the new URL.
  const urlChanged = instanceUrl !== storedUrl;
  try {
    if (urlChanged) {
      await AuthManager.storeUrl(context, instanceUrl);
    }
    try {
      await AuthManager.storeToken(context, token);
    } catch (tokenError) {
      if (urlChanged) {
        if (storedUrl) {
          await AuthManager.storeUrl(context, storedUrl);
        } else {
          await AuthManager.deleteUrl(context);
        }
      }
      throw tokenError;
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to store the Home Assistant URL and token: ${error.message}. The stored URL and token are unchanged.`,
    );
    return;
  }

  vscode.window.showInformationMessage(
    urlChanged
      ? `Home Assistant instance URL (${instanceUrl}) and token have been securely stored.`
      : "Home Assistant token has been securely stored.",
  );

  // Both are stored: remove any copies left in the user settings
  await removeUserSettingCopies(urlChanged ? ["hostUrl", "longLivedAccessToken"] : ["longLivedAccessToken"]);
}

/**
 * Removes copies of the given settings from the user settings, once the values are in
 * SecretStorage. Tries every setting even if one fails, and reports any that are left.
 */
async function removeUserSettingCopies(keys: string[]): Promise<void> {
  const config = vscode.workspace.getConfiguration("vscode-ha-config");
  const failed: string[] = [];
  for (const key of keys) {
    if (config.inspect(key)?.globalValue === undefined) {
      continue;
    }
    try {
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    } catch {
      failed.push(`vscode-ha-config.${key}`);
    }
  }
  if (failed.length > 0) {
    vscode.window.showWarningMessage(
      `The value is stored securely, but the old copy in your user settings couldn't be removed: ${failed.join(", ")}. Remove it from your user settings yourself.`,
    );
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

function describeConnectionError(error: any): string {
  if (!error) {
    return "Unknown error";
  }
  // undici's fetch hides the real failure under error.cause; Node http/https
  // errors carry a `.code` directly. Unwrap both so the user sees the cause.
  const cause = error.cause ?? error;
  const code = cause.code ?? error.code;
  const baseMessage = cause.message ?? error.message ?? String(error);

  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `${baseMessage} — the hostname could not be resolved. Check the URL/DNS. mDNS '.local' names often don't resolve from the editor; try the IP address instead.`;
    case "ECONNREFUSED":
      return `${baseMessage} — connection refused. Make sure Home Assistant is running and reachable at this host and port.`;
    case "ETIMEDOUT":
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return `${baseMessage} — could not reach the host. Check your network/firewall and that the port is correct.`;
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
      return `${baseMessage} — TLS certificate problem. For a self-signed certificate, set 'vscode-ha-config.ignoreCertificates' to true.`;
    default:
      return code ? `${baseMessage} (${code})` : baseMessage;
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

      // Use the same Node http/https transport as the status bar and the
      // language-server websocket. The previous implementation used the global
      // `fetch` (undici), which behaves differently in the extension host
      // (proxy handling, DNS/Happy-Eyeballs) and collapses every failure into
      // an opaque "fetch failed" message, hiding the real cause.
      const config = vscode.workspace.getConfiguration("vscode-ha-config");
      const ignoreCertificates = !!config.get<boolean>("ignoreCertificates");

      try {
        const result = await testHomeAssistantConnection(hostUrl, token, ignoreCertificates);

        progress.report({ increment: 50, message: "Validating response..." });

        if (result.success) {
          progress.report({ increment: 100, message: "Connection successful!" });
          const version =
            result.data && result.data.version && result.data.version !== "unknown"
              ? ` (version ${result.data.version})`
              : "";
          vscode.window.showInformationMessage(
            `Successfully connected to Home Assistant at ${hostUrl}${version}. API is running.`
          );
        } else {
          progress.report({ increment: 100, message: "Connection failed." });
          vscode.window.showErrorMessage(
            `Failed to connect to Home Assistant at ${hostUrl}: ${result.message}`
          );
        }
      } catch (error) {
        progress.report({ increment: 100, message: "Connection error." });
        vscode.window.showErrorMessage(
          `Error connecting to Home Assistant at ${hostUrl}: ${describeConnectionError(error)}`
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
      vscode.window.showInformationMessage(
        AuthManager.usesWorkspaceCredentials()
          ? `Home Assistant instance URL has been securely stored: ${newUrl}. This workspace sets its own connection in its settings, so it keeps using that.`
          : `Home Assistant instance URL has been securely stored: ${newUrl}`,
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to store Home Assistant instance URL: ${error.message}`);
      return;
    }
    await removeUserSettingCopies(["hostUrl"]);
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
