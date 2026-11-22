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
 * If a trusted workspace's settings set the URL or the token, that workspace uses its own
 * connection: both come from the workspace settings, and a missing one stays missing. The
 * user's own token is never sent to a URL the workspace chose, or the other way round.
 *
 * Otherwise each is looked up in this order, and the first one found is used:
 * 1. SecretStorage, the user's own credentials across all workspaces.
 * 2. Environment variables (HASS_TOKEN / HASS_SERVER, or SUPERVISOR_TOKEN in the add-on).
 * 3. User (global) settings that haven't been migrated to SecretStorage yet.
 *
 * Workspace settings are ignored in an untrusted workspace (Restricted Mode). Only user
 * settings are ever migrated to SecretStorage: workspace settings belong to that workspace and
 * are left where they are.
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
   * The token or URL set in the workspace settings, if any. Always undefined in an untrusted
   * workspace, so opening a folder can't redirect the connection.
   */
  public static getWorkspaceSetting(kind: CredentialKind): string | undefined {
    if (!vscode.workspace.isTrusted) {
      return undefined;
    }
    return AuthManager.inspectSetting(kind)?.workspaceValue || undefined;
  }

  /**
   * Whether this workspace sets its own connection (URL, token or both) in its settings
   */
  public static usesWorkspaceCredentials(): boolean {
    return !!(AuthManager.getWorkspaceSetting("url") || AuthManager.getWorkspaceSetting("token"));
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
    if (AuthManager.usesWorkspaceCredentials()) {
      const workspaceValue = AuthManager.getWorkspaceSetting(kind);
      return workspaceValue ? { value: workspaceValue, source: "workspace settings" } : undefined;
    }
    return AuthManager.resolveShared(context, kind);
  }

  /**
   * Find the URL and token to connect with, from one decision about where they come from.
   * Use this, not getUrl and getToken one after the other, whenever the token is sent to the
   * URL: the workspace settings could change between two separate lookups.
   */
  public static async resolveConnection(
    context: vscode.ExtensionContext,
  ): Promise<{ url?: ResolvedCredential; token?: ResolvedCredential }> {
    if (AuthManager.usesWorkspaceCredentials()) {
      // No await between the decision and these reads
      const url = AuthManager.getWorkspaceSetting("url");
      const token = AuthManager.getWorkspaceSetting("token");
      return {
        url: url ? { value: url, source: "workspace settings" } : undefined,
        token: token ? { value: token, source: "workspace settings" } : undefined,
      };
    }
    const [url, token] = await Promise.all([
      AuthManager.resolveShared(context, "url"),
      AuthManager.resolveShared(context, "token"),
    ]);
    return { url, token };
  }

  /**
   * Find the token or URL the user has set up for every workspace, ignoring workspace settings
   */
  public static async resolveShared(
    context: vscode.ExtensionContext,
    kind: CredentialKind,
  ): Promise<ResolvedCredential | undefined> {
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
   * Tell the user this workspace's settings set only half of the connection, and offer to open
   * them. The missing half is never taken from the user's own credentials.
   */
  public static showIncompleteWorkspaceCredentials(): void {
    const openSettings = "Open Workspace Settings";
    void vscode.window
      .showWarningMessage(
        "This workspace's settings set only part of the Home Assistant connection. Set both vscode-ha-config.hostUrl and vscode-ha-config.longLivedAccessToken in the workspace settings, or remove both to use your stored credentials.",
        openSettings,
      )
      .then((selection) => {
        if (selection === openSettings) {
          void vscode.commands.executeCommand("workbench.action.openWorkspaceSettings", {
            query: "vscode-ha-config",
          });
        }
      });
  }

  /**
   * Get the token, asking for the instance URL and token if none is configured anywhere.
   * Migrates credentials from the user settings to SecretStorage on the way.
   * @param context Extension context
   * @returns The token or undefined if not found
   */
  public static async getTokenWithUI(context: vscode.ExtensionContext): Promise<string | undefined> {
    // A workspace with its own connection gets both values from its settings: anything typed
    // here would be stored for every workspace instead
    if (AuthManager.usesWorkspaceCredentials()) {
      const workspaceToken = await AuthManager.getToken(context);
      if (!workspaceToken || !(await AuthManager.getUrl(context))) {
        AuthManager.showIncompleteWorkspaceCredentials();
      }
      return workspaceToken;
    }

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
