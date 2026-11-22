import * as assert from "assert";
import { HassServices } from "home-assistant-js-websocket";
import { CompletionItem, CompletionItemKind, Diagnostic } from "vscode-languageserver-protocol";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getLanguageService } from "yaml-language-server/out/src/languageservice/yamlLanguageService";
import { HomeAssistantConfiguration } from "../../language-service/src/haConfig/haConfig";
import { HomeAssistantLanguageService } from "../../language-service/src/haLanguageService";
import { IHaConnection } from "../../language-service/src/home-assistant/haConnection";
import { SchemaServiceForIncludes } from "../../language-service/src/schemas/schemaService";
import { diagnosticText } from "./diagnosticHelpers";

class MockFileAccessor {
  getFileContents(): string {
    return "";
  }
}

const completion = (label: string): CompletionItem => ({
  label,
  kind: CompletionItemKind.Variable,
});

class MockHaConnection implements IHaConnection {
  async tryConnect(): Promise<void> { /* mock */ }
  async notifyConfigUpdate(_conf: any): Promise<void> { /* mock */ }
  async getAreaCompletions(): Promise<CompletionItem[]> {
    return [completion("living_room"), completion("kitchen")];
  }
  async getDeviceCompletions(): Promise<CompletionItem[]> {
    return [completion("abc123")];
  }
  async getDomainCompletions(): Promise<CompletionItem[]> {
    return [];
  }
  async getEntityCompletions(): Promise<CompletionItem[]> {
    return [];
  }
  async getFloorCompletions(): Promise<CompletionItem[]> {
    return [];
  }
  async getLabelCompletions(): Promise<CompletionItem[]> {
    return [];
  }
  async getServiceCompletions(): Promise<CompletionItem[]> {
    return [];
  }
  async getHassEntities(): Promise<any> {
    return {
      "light.kitchen": {},
      "light.living_room": {},
      "sensor.energy_cost": {},
    };
  }
  async getHassDevices(): Promise<any> {
    return {};
  }
  async getHassEntityRegistry(): Promise<any> {
    return {};
  }
  async getHassServices(): Promise<HassServices> {
    const service = { name: "", description: "", fields: {}, target: {} };
    return {
      light: { turn_on: service },
      utility_meter: { calibrate: service },
    } as unknown as HassServices;
  }
  async resolveEntityCompletionDocumentation(_entityId: string): Promise<any> {
    return undefined;
  }
}

/**
 * Multi-line lists (`key:` followed by `- item` lines) must only be validated against the key
 * that directly owns them. Previously the check walked up to the previous blank line and used
 * any matching key it passed, so lists were checked against the wrong key.
 */
suite("List Scope Validation Mock Test", () => {
  let languageService: HomeAssistantLanguageService;

  setup(async () => {
    const haConfig = new HomeAssistantConfiguration(new MockFileAccessor() as any);
    const yamlLanguageService = getLanguageService({
      schemaRequestService: async () => "",
      workspaceContext: null as any,
      telemetry: undefined,
    });
    languageService = new HomeAssistantLanguageService(
      yamlLanguageService,
      haConfig,
      new MockHaConnection() as any,
      [],
      await SchemaServiceForIncludes.create(),
      () => { /* not needed in this test */ },
      () => { /* not needed in this test */ },
      { isConfigured: true, autoRenderTemplates: true } as any,
    );
  });

  // yaml-language-server caches parsed documents by URI and version, so each test needs its own URI
  let documentCount = 0;

  const diagnose = async (content: string): Promise<Diagnostic[]> => {
    documentCount++;
    const document = TextDocument.create(
      `file:///list-scope${documentCount}.yaml`,
      "yaml",
      1,
      content,
    );
    return languageService.getDiagnostics(document);
  };

  const withCode = (diagnostics: Diagnostic[], code: string): string[] =>
    diagnostics.filter((d) => d.code === code).map(diagnosticText);

  test("entity_id list below target is not checked as actions", async () => {
    const diagnostics = await diagnose(`automation:
  - alias: Calibrate
    action:
      - action: utility_meter.calibrate
        target:
          entity_id:
            - sensor.energy_cost
            - light.kitchen
`);

    assert.deepStrictEqual(withCode(diagnostics, "unknown-action"), []);
    assert.deepStrictEqual(withCode(diagnostics, "unknown-entity"), []);
  });

  test("an earlier area list doesn't capture later automations without blank lines", async () => {
    // The automation editor writes automations.yaml without any blank lines
    const diagnostics = await diagnose(`- id: '1640515873079'
  alias: Hallway
  triggers:
  - trigger: state
    entity_id: light.kitchen
  actions:
  - action: light.turn_on
    target:
      area_id:
      - living_room
- id: '1640515873080'
  alias: Sunset
  triggers:
  - trigger: sun
    event: sunset
  actions:
  - action: light.turn_on
    target:
      entity_id: light.living_room
`);

    assert.deepStrictEqual(withCode(diagnostics, "unknown-area"), []);
    assert.deepStrictEqual(withCode(diagnostics, "unknown-device"), []);
  });

  test("every item of a list is validated, not only the first", async () => {
    const diagnostics = await diagnose(`script:
  test:
    sequence:
      - action: light.turn_on
        target:
          entity_id:
            - light.kitchen
            # A comment between items
            - light.living_room

            - light.missing_one
            - light.missing_two
`);

    assert.deepStrictEqual(withCode(diagnostics, "unknown-entity"), [
      "Entity 'light.missing_one' does not exist in your Home Assistant instance",
      "Entity 'light.missing_two' does not exist in your Home Assistant instance",
    ]);
  });

  test("a key on a list item line, or with a comment, owns the list below it", async () => {
    const diagnostics = await diagnose(`automation:
  - triggers:
      - entity_id:
          - light.missing_one
    conditions:
      - condition: state
        entity_id: # lights to check
          - light.missing_two
        state: "on"
`);

    assert.deepStrictEqual(withCode(diagnostics, "unknown-entity"), [
      "Entity 'light.missing_one' does not exist in your Home Assistant instance",
      "Entity 'light.missing_two' does not exist in your Home Assistant instance",
    ]);
  });

  test("MQTT device identifiers are not checked as device IDs", async () => {
    const diagnostics = await diagnose(`mqtt:
  sensor:
    - name: Wallbox
      state_topic: warp3/abc/evse/state
      device:
        identifiers:
          - "warp3-abc"
`);

    assert.deepStrictEqual(withCode(diagnostics, "unknown-device"), []);
  });

  test("a list doesn't continue into the next YAML document", async () => {
    const diagnostics = await diagnose(`area_id:
- living_room
---
- light.turn_on
`);

    assert.deepStrictEqual(withCode(diagnostics, "unknown-area"), []);
  });

  test("a document marker with a comment after it also ends the list", async () => {
    const diagnostics = await diagnose(`area_id:
- living_room
--- # next document
- light.turn_on
`);

    assert.deepStrictEqual(withCode(diagnostics, "unknown-area"), []);
  });

  test("a key with an anchor still owns the list below it", async () => {
    const diagnostics = await diagnose(`script:
  test:
    sequence:
      - action: light.turn_on
        target:
          entity_id: &targets
            - light.kitchen
            - light.missing_one
`);

    assert.deepStrictEqual(withCode(diagnostics, "unknown-entity"), [
      "Entity 'light.missing_one' does not exist in your Home Assistant instance",
    ]);
  });
});
