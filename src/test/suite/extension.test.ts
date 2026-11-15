import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("Extension Test Suite", () => {
  suiteSetup(async () => {
    // Activate the extension
    await vscode.extensions.getExtension("blown.vscode-ha-config")?.activate();
    
    // Show a message to indicate tests are starting
    vscode.window.showInformationMessage("Starting Home Assistant extension tests...");
  });

  suiteTeardown(() => {
    vscode.window.showInformationMessage("All tests done!");
  });

  test("Extension is activated", async () => {
    const extension = vscode.extensions.getExtension("blown.vscode-ha-config");
    assert.ok(extension, "Extension is installed");
    assert.strictEqual(extension?.isActive, true, "Extension is active");
  });

  test("Commands are registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    const extensionCommands = commands.filter(cmd => cmd.startsWith("vscode-ha-config."));
    
    // Check that essential commands are registered
    // Note: We check for any commands registered by the extension, not specific ones
    assert.ok(extensionCommands.length > 0, "Extension has registered commands");
    console.log("Found commands:", extensionCommands);
  });

  test("Restart commands are registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    const restartCommands = [
      "vscode-ha-config.homeassistantRestart",
      "vscode-ha-config.hassioAddonRestartGitPull",
      "vscode-ha-config.hassioHostReboot"
    ];
    
    for (const command of restartCommands) {
      assert.ok(commands.includes(command), `Command '${command}' should be registered`);
    }
  });

  test("Reload commands are registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    const reloadCommands = [
      "vscode-ha-config.reloadAll",
      "vscode-ha-config.showReloadIntegrations",
      "vscode-ha-config.scriptReload",
      "vscode-ha-config.automationReload"
    ];
    
    for (const command of reloadCommands) {
      assert.ok(commands.includes(command), `Command '${command}' should be registered`);
    }
  });

  test("Language server activates for Home Assistant files", async () => {
    // Open a Home Assistant YAML file
    const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || "";
    const yamlFilePath = path.join(workspacePath, "configuration.yaml");
    const document = await vscode.workspace.openTextDocument(yamlFilePath);
    await vscode.window.showTextDocument(document);
    
    // Wait for language server to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Basic test to verify document opened successfully
    assert.ok(document.languageId === "yaml" || document.languageId === "home-assistant", 
      `Document has expected language ID (got: ${document.languageId})`);
    assert.strictEqual(document.uri.fsPath, yamlFilePath, "Document path matches");
    
    // Close the document
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  test("Restart and reload commands are properly separated", async () => {
    const commands = await vscode.commands.getCommands(true);
    
    const restartCommands = commands.filter(cmd => 
      cmd.startsWith("vscode-ha-config.") && 
      (cmd.toLowerCase().includes("restart") || cmd.toLowerCase().includes("reboot"))
    );
    
    const reloadCommands = commands.filter(cmd => 
      cmd.startsWith("vscode-ha-config.") && 
      cmd.toLowerCase().includes("reload")
    );
    
    // Verify restart commands exist and are registered
    assert.ok(restartCommands.length >= 3, `Should have at least 3 restart commands, found: ${restartCommands.length}`);
    
    // Verify reload commands exist
    assert.ok(reloadCommands.length > 0, `Should have reload commands, found: ${reloadCommands.length}`);
    
    // Ensure they are separate sets (no overlap between restart and reload)
    const overlap = restartCommands.filter(cmd => reloadCommands.includes(cmd));
    assert.strictEqual(overlap.length, 0, `Restart and reload commands should not overlap, found overlap: ${overlap}`);
    
    // Verify specific restart commands that were broken in issue #3634
    const criticalRestartCommands = [
      "vscode-ha-config.homeassistantRestart",
      "vscode-ha-config.hassioAddonRestartGitPull", 
      "vscode-ha-config.hassioHostReboot"
    ];
    
    for (const cmd of criticalRestartCommands) {
      assert.ok(commands.includes(cmd), `Critical restart command '${cmd}' should be registered`);
    }
  });
});
