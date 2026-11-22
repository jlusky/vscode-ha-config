import * as assert from "assert";
import { CompletionItem, Diagnostic, Range } from "vscode-languageserver-protocol";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getLanguageService } from "yaml-language-server/out/src/languageservice/yamlLanguageService";
import { HomeAssistantConfiguration } from "../../language-service/src/haConfig/haConfig";
import { HomeAssistantLanguageService } from "../../language-service/src/haLanguageService";
import { SchemaServiceForIncludes } from "../../language-service/src/schemas/schemaService";
import {
  applyIgnoreDirectives,
  parseIgnoreDirectives,
} from "../../language-service/src/utils/ignoreDirectives";
import { diagnosticText } from "./diagnosticHelpers";

class MockFileAccessor {
  getFileContents(): string {
    return "";
  }
}

// Connected, with only light.kitchen; everything else is an unknown entity
class MockHaConnection {
  async getAreaCompletions(): Promise<CompletionItem[]> {
    return [];
  }
  async getDeviceCompletions(): Promise<CompletionItem[]> {
    return [];
  }
  async getFloorCompletions(): Promise<CompletionItem[]> {
    return [];
  }
  async getLabelCompletions(): Promise<CompletionItem[]> {
    return [];
  }
  async getHassEntities(): Promise<any> {
    return { "light.kitchen": {} };
  }
  async getHassEntityRegistry(): Promise<any> {
    return {};
  }
  async getHassServices(): Promise<any> {
    return undefined;
  }
}

const document = (content: string, uri = "file:///ignore-directives.yaml"): TextDocument =>
  TextDocument.create(uri, "yaml", 1, content);

suite("Ignore Directives Mock Test", () => {
  let languageService: HomeAssistantLanguageService;
  let documentCount = 0;

  setup(async () => {
    languageService = new HomeAssistantLanguageService(
      getLanguageService({
        schemaRequestService: async () => "",
        workspaceContext: null as any,
        telemetry: undefined,
      }),
      new HomeAssistantConfiguration(new MockFileAccessor() as any),
      new MockHaConnection() as any,
      [],
      await SchemaServiceForIncludes.create(),
      () => { /* not needed in this test */ },
      () => { /* not needed in this test */ },
      { isConfigured: true, autoRenderTemplates: true } as any,
    );
  });

  // yaml-language-server caches parsed documents by URI and version, so each test needs its own URI
  const unknownEntities = async (content: string): Promise<string[]> => {
    documentCount++;
    const diagnostics = await languageService.getDiagnostics(
      document(content, `file:///ignore-directives${documentCount}.yaml`),
    );
    return diagnostics.filter((d) => d.code === "unknown-entity").map(diagnosticText);
  };

  const unknown = (id: string): string =>
    `Entity '${id}' does not exist in your Home Assistant instance`;

  test("without directives every unknown entity is reported", async () => {
    assert.deepStrictEqual(
      await unknownEntities("entity_id:\n  - light.remote_one\n  - light.kitchen\n"),
      [unknown("light.remote_one")],
    );
  });

  test("ignore silences the listed IDs in the whole file", async () => {
    const reported = await unknownEntities(`# homeassistant:ignore light.remote_one, light.remote_two
entity_id:
  - light.remote_one
  - light.remote_two
  - light.remote_three
`);

    assert.deepStrictEqual(reported, [unknown("light.remote_three")]);
  });

  test("disable-line, disable-next-line and disable/enable silence lines", async () => {
    const reported = await unknownEntities(`entity_id:
  - light.inline  # homeassistant:disable-line
  # homeassistant:disable-next-line
  - light.next
  - light.after_next
  # homeassistant:disable
  - light.range_one
  - light.range_two
  # homeassistant:enable
  - light.after_range
`);

    assert.deepStrictEqual(reported, [
      unknown("light.after_next"),
      unknown("light.after_range"),
    ]);
  });

  test("a directive inside a quoted value or without a space before # is not a comment", () => {
    const { disabledLines, ignoredIds } = parseIgnoreDirectives(
      document(`name: "a # homeassistant:disable-line"
color: '#ff0000 homeassistant:disable-line'
url: http://example.com/#homeassistant:disable-line
name: "quoted" # homeassistant:ignore light.a light.b
`),
    );

    assert.deepStrictEqual([...disabledLines], []);
    assert.deepStrictEqual([...ignoredIds], ["light.a", "light.b"]);
  });

  test("other diagnostics, such as schema errors, are never silenced", () => {
    const doc = document("# homeassistant:disable\nentity_id: light.remote\n");
    const range = Range.create(1, 11, 1, 23);
    const diagnostics: Diagnostic[] = [
      { range, message: "Entity 'light.remote' does not exist", source: "home-assistant" },
      { range, message: "Incorrect type.", source: "yaml-schema" },
    ];

    assert.deepStrictEqual(
      applyIgnoreDirectives(doc, diagnostics).map((d) => d.source),
      ["yaml-schema"],
    );
  });
});
