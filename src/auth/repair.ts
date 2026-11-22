import * as vscode from "vscode";
import { AuthManager } from "./manager";

/**
 * Repair the Home Assistant authentication configuration (token and Home Assistant instance URL)
 * This function addresses common migration and storage issues for both token and URL.
 * Only the user settings are migrated or cleaned up: a token or URL in the workspace settings
 * belongs to that workspace and is left alone.
 */
export async function repairAuthConfiguration(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("vscode-ha-config");
  
  // Only user settings are migrated; SecretStorage is checked on its own
  const settingsToken = AuthManager.getUserSetting("token");
  const secretToken = await AuthManager.getSecret(context, "token");
  const workspaceToken = AuthManager.getWorkspaceSetting("token");
  const environmentToken = AuthManager.getEnvironment("token");

  const settingsUrl = AuthManager.getUserSetting("url");
  const secretUrl = await AuthManager.getSecret(context, "url");
  const workspaceUrl = AuthManager.getWorkspaceSetting("url");
  const environmentUrl = AuthManager.getEnvironment("url");

  let issuesFixed = false;
  const messages: string[] = [];

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = "Repairing Home Assistant authentication...";
  statusBar.show();

  try {
    // --- Token Repair Logic ---
    if (settingsToken && !secretToken) {
      await AuthManager.storeToken(context, settingsToken);
      await config.update("longLivedAccessToken", undefined, vscode.ConfigurationTarget.Global);
      messages.push("Token migrated from user settings to secure storage.");
      issuesFixed = true;
    } else if (settingsToken && secretToken) {
      await config.update("longLivedAccessToken", undefined, vscode.ConfigurationTarget.Global);
      messages.push("Duplicate token in user settings.json removed; secure token kept.");
      issuesFixed = true;
    } else if (!settingsToken && !secretToken && (workspaceToken || environmentToken)) {
      messages.push(`Token is set in the ${workspaceToken ? "workspace settings" : "environment"}.`);
    } else if (!settingsToken && !secretToken) {
      messages.push("No token found. Please set one using 'Manage Home Assistant Authentication'.");
    } else {
      messages.push("Token is correctly stored securely.");
    }

    // --- URL Repair Logic ---
    if (settingsUrl && !secretUrl) {
      await AuthManager.storeUrl(context, settingsUrl);
      await config.update("hostUrl", undefined, vscode.ConfigurationTarget.Global);
      messages.push("Home Assistant instance URL migrated from user settings to secure storage.");
      issuesFixed = true;
    } else if (settingsUrl && secretUrl) {
      await config.update("hostUrl", undefined, vscode.ConfigurationTarget.Global);
      messages.push("Duplicate Home Assistant instance URL in user settings.json removed; secure URL kept.");
      issuesFixed = true;
    } else if (!settingsUrl && !secretUrl && (workspaceUrl || environmentUrl)) {
      messages.push(`Home Assistant instance URL is set in the ${workspaceUrl ? "workspace settings" : "environment"}.`);
    } else if (!settingsUrl && !secretUrl) {
      messages.push("No Home Assistant instance URL found. Please set one using 'Manage Home Assistant Authentication'.");
      // Prompt to set URL if not found at all
      const newUrl = await vscode.window.showInputBox({
        prompt: "Enter your Home Assistant instance URL (e.g., http://homeassistant.local:8123)",
        placeHolder: "http://homeassistant.local:8123",
        ignoreFocusOut: true,
      });
      if (newUrl) {
        await AuthManager.storeUrl(context, newUrl);
        messages.push(`Home Assistant instance URL set to: ${newUrl}`);
        issuesFixed = true;
      }
    } else {
      messages.push("Home Assistant instance URL is correctly stored securely.");
    }

    if (issuesFixed) {
      vscode.window.showInformationMessage(
        `Home Assistant auth repair complete: ${messages.join(" ")}`
      );
    } else {
      vscode.window.showInformationMessage(
        `Home Assistant auth check complete: ${messages.join(" ")}`
      );
    }

  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to repair auth configuration: ${error.message}`
    );
  } finally {
    statusBar.dispose();
  }
}
