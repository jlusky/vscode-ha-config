import * as vscode from "vscode";

/** Where the token or instance URL in use came from */
export type CredentialSource =
  | "workspace settings"
  | "SecretStorage"
  | "environment"
  | "user settings";

export interface ResolvedCredential {
  value: string;
  source: CredentialSource;
}

type CredentialKind = "token" | "url";

/**
 * AuthManager class to handle Home Assistant tokens and Home Assistant instance URL.
 *
 * The token and URL are looked up in this order, and the first one found is used:
 * 1. Workspace or folder settings (settings.json of the open workspace). Each workspace can
 *    point at its own Home Assistant instance, and anyone who can open the configuration
 *    folder can change Home Assistant anyway.
 * 2. SecretStorage, the user's own credentials across all workspaces.
 * 3. Environment variables (HASS_TOKEN / HASS_SERVER, or SUPERVISOR_TOKEN in the add-on).
 * 4. User (global) settings that haven't been migrated to SecretStorage yet.
 *
 * Only user settings are ever migrated to SecretStorage: workspace settings belong to that
 * workspace and are left where they are.
 */
export class AuthManager {
  private static readonly TOKEN_KEY = "home-assistant.token";
  private static readonly URL_KEY = "home-assistant.url";
  private static readonly SETTINGS_SECTION = "vscode-ha-config";

  private static readonly settingKeys: Record<CredentialKind, string> = {
    token: "longLivedAccessToken",
    url: "hostUrl",
  };

  private static readonly secretKeys: Record<CredentialKind, string> = {
    token: AuthManager.TOKEN_KEY,
    url: AuthManager.URL_KEY,
  };

  private static inspectSetting(kind: CredentialKind) {
    return vscode.workspace
      .getConfiguration(AuthManager.SETTINGS_SECTION)
      .inspect<string>(AuthManager.settingKeys[kind]);
  }

  /**
   * The token or URL set in the workspace or folder settings, if any
   */
  public static getWorkspaceSetting(kind: CredentialKind): string | undefined {
    const inspection = AuthManager.inspectSetting(kind);
    return inspection?.workspaceFolderValue || inspection?.workspaceValue || undefined;
  }

  /**
   * The token or URL set in the user (global) settings, if any
   */
  public static getUserSetting(kind: CredentialKind): string | undefined {
    return AuthManager.inspectSetting(kind)?.globalValue || undefined;
  }

  /**
   * The token or URL from SecretStorage, if any
   */
  public static async getSecret(
    context: vscode.ExtensionContext,
    kind: CredentialKind,
  ): Promise<string | undefined> {
    return (await context.secrets.get(AuthManager.secretKeys[kind])) || undefined;
  }

  /**
   * The token or URL from environment variables, if any
   */
  public static getEnvironment(kind: CredentialKind): string | undefined {
    if (kind === "token") {
      return process.env.HASS_TOKEN || process.env.SUPERVISOR_TOKEN || undefined;
    }
    return (
      process.env.HASS_SERVER ||
      (process.env.SUPERVISOR_TOKEN ? "http://supervisor/core" : undefined)
    );
  }

  /**
   * Find the token or URL to use, and where it came from (see the class comment for the order)
   */
  public static async resolve(
    context: vscode.ExtensionContext,
    kind: CredentialKind,
  ): Promise<ResolvedCredential | undefined> {
    const workspaceValue = AuthManager.getWorkspaceSetting(kind);
    if (workspaceValue) {
      return { value: workspaceValue, source: "workspace settings" };
    }

    const secretValue = await AuthManager.getSecret(context, kind);
    if (secretValue) {
      return { value: secretValue, source: "SecretStorage" };
    }

    const environmentValue = AuthManager.getEnvironment(kind);
    if (environmentValue) {
      return { value: environmentValue, source: "environment" };
    }

    const userValue = AuthManager.getUserSetting(kind);
    if (userValue) {
      return { value: userValue, source: "user settings" };
    }

    return undefined;
  }

  /**
   * Get the token to use
   * @param context Extension context
   * @returns The token or undefined if not found
   */
  public static async getToken(context: vscode.ExtensionContext): Promise<string | undefined> {
    return (await AuthManager.resolve(context, "token"))?.value;
  }

  /**
   * Store a token in SecretStorage
   * @param context Extension context
   * @param token Token to store
   */
  public static async storeToken(context: vscode.ExtensionContext, token: string): Promise<void> {
    await context.secrets.store(AuthManager.TOKEN_KEY, token);
  }

  /**
   * Delete the stored token from SecretStorage
   * @param context Extension context
   */
  public static async deleteToken(context: vscode.ExtensionContext): Promise<void> {
    await context.secrets.delete(AuthManager.TOKEN_KEY);
  }

  /**
   * Get the Home Assistant instance URL to use
   * @param context Extension context
   * @returns The URL or undefined if not found
   */
  public static async getUrl(context: vscode.ExtensionContext): Promise<string | undefined> {
    return (await AuthManager.resolve(context, "url"))?.value;
  }

  /**
   * Store a URL in SecretStorage
   * @param context Extension context
   * @param url URL to store
   */
  public static async storeUrl(context: vscode.ExtensionContext, url: string): Promise<void> {
    await context.secrets.store(AuthManager.URL_KEY, url);
  }

  /**
   * Delete the stored URL from SecretStorage
   * @param context Extension context
   */
  public static async deleteUrl(context: vscode.ExtensionContext): Promise<void> {
    await context.secrets.delete(AuthManager.URL_KEY);
  }

  /**
   * Check if both a token and a URL are available from any source.
   * @param context Extension context
   * @returns True if both token and URL are found, false otherwise.
   */
  public static async hasCredentials(context: vscode.ExtensionContext): Promise<boolean> {
    const token = await AuthManager.getToken(context);
    const url = await AuthManager.getUrl(context);
    return !!token && !!url;
  }

  /**
   * Move a token from the user settings.json to SecretStorage. Workspace settings are never
   * migrated. Does nothing if SecretStorage already has a token.
   * @param context Extension context
   * @returns true if a token was migrated, false otherwise
   */
  public static async migrateTokenFromSettings(context: vscode.ExtensionContext): Promise<boolean> {
    return AuthManager.migrateUserSetting(
      context,
      "token",
      "Your Home Assistant access token has been securely migrated to VS Code's SecretStorage. It is no longer stored in your user settings.json file.",
    );
  }

  /**
   * Move the Home Assistant instance URL from the user settings.json to SecretStorage.
   * Workspace settings are never migrated. Does nothing if SecretStorage already has a URL.
   * @param context Extension context
   * @returns true if a URL was migrated, false otherwise
   */
  public static async migrateUrlFromSettings(context: vscode.ExtensionContext): Promise<boolean> {
    return AuthManager.migrateUserSetting(
      context,
      "url",
      "Your Home Assistant instance URL has been securely migrated to VS Code's SecretStorage. It is no longer stored in your user settings.json file.",
    );
  }

  private static async migrateUserSetting(
    context: vscode.ExtensionContext,
    kind: CredentialKind,
    message: string,
  ): Promise<boolean> {
    const userValue = AuthManager.getUserSetting(kind);
    if (!userValue || (await AuthManager.getSecret(context, kind))) {
      return false;
    }

    try {
      await context.secrets.store(AuthManager.secretKeys[kind], userValue);
      await vscode.workspace
        .getConfiguration(AuthManager.SETTINGS_SECTION)
        .update(AuthManager.settingKeys[kind], undefined, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(message);
      return true;
    } catch (error) {
      console.error(`Failed to migrate the ${kind} to SecretStorage:`, error);
      return false;
    }
  }

  /**
   * Get the token, asking for the instance URL and token if none is configured anywhere.
   * Migrates credentials from the user settings to SecretStorage on the way.
   * @param context Extension context
   * @returns The token or undefined if not found
   */
  public static async getTokenWithUI(context: vscode.ExtensionContext): Promise<string | undefined> {
    await AuthManager.migrateUrlFromSettings(context);
    let hostUrl = await AuthManager.getUrl(context);

    // If no URL is configured, ask for it
    if (!hostUrl) {
      hostUrl = await vscode.window.showInputBox({
        prompt: "Enter your Home Assistant instance URL",
        placeHolder: "http://homeassistant.local:8123",
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

      // User canceled the Home Assistant instance URL input
      if (!hostUrl) {
        return undefined;
      }

      // Store URL in SecretStorage
      await AuthManager.storeUrl(context, hostUrl);
      vscode.window.showInformationMessage(`Home Assistant instance URL set to: ${hostUrl}`);
    }

    await AuthManager.migrateTokenFromSettings(context);
    let token = await AuthManager.getToken(context);

    // If still no token, prompt user to enter one
    if (!token) {
      token = await vscode.window.showInputBox({
        prompt: "Enter your Home Assistant Long-Lived Access Token",
        password: true,
        placeHolder: "eyJhbGci..."
      });

      if (token) {
        await AuthManager.storeToken(context, token);
      }
    }

    return token;
  }
}
