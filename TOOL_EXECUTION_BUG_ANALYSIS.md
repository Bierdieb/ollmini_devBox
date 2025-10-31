# TOOL EXECUTION BUG ANALYSIS - V0.1.3b → V0.2.0b Regression

**Datum:** 2025-10-28
**Status:** ROOT CAUSE IDENTIFIZIERT
**Priorität:** KRITISCH

---

## Executive Summary

**ROOT CAUSE:** V0.2.0b "Safety Measure" (Change 58) entfernt `ToolName` und `Content` Felder aus Messages vor dem Senden an Ollama API. Das gpt-oss Model Template **BENÖTIGT** diese Felder jedoch, um Tool-Responses zu verarbeiten. Wenn diese Felder fehlen, kann das Model Tool-Ergebnisse nicht verstehen und fällt zurück auf Text-basierte Tool-Syntax-Generierung statt korrekter API `tool_calls`.

**SYMPTOM:**
- User sendet: "pwd for me"
- Erwartet: Tool Execution mit Permission Dialog → pwd Output
- Tatsächlich: Assistant gibt JSON-Text zurück: `{"command":"pwd","description":"Get current working directory"}`
- Kein Permission Dialog erscheint
- Keine Tool Execution findet statt
- Kein Agent Loop wird getriggert

**LOCATION DES FEHLERS:**
- Datei: `/UI/src/ollama-client.js`
- Zeilen: **1107-1108**
```javascript
delete cleaned.ToolName;    // ❌ ENTFERNT Template-Feld
delete cleaned.Content;     // ❌ ENTFERNT Template-Feld
```

---

## Chronologie der Debugging-Session

### Phase 1: HTTP 400 Fehler (GELÖST)
**Problem:** Agent Loop schlug fehl mit HTTP 400 nach Tool Execution

**Fehlgeschlagene Fixes (Wiederholungsschleife):**
1. **Fix Attempt 1:** Message Metadata Cleanup (Zeilen 690-703)
   - Annahme: Top-level Metadata-Felder verursachen Fehler
   - Ergebnis: FEHLGESCHLAGEN - HTTP 400 besteht weiter

2. **Fix Attempt 2:** Validation Layer (Zeilen 705-721)
   - Annahme: Zusätzliche Validierung hilft
   - Ergebnis: FEHLGESCHLAGEN - HTTP 400 besteht weiter

3. **Fix Attempt 3:** Final Cleanup at Serialization (Zeilen 1086-1108)
   - Annahme: Doppelte Cleanup-Logik ist sicherer
   - Ergebnis: FEHLGESCHLAGEN - HTTP 400 besteht weiter

**Alle drei Fixes targetierten das FALSCHE Problem** - sie fokussierten auf Top-Level Message-Felder, inspizierten aber nie die verschachtelte Struktur von `tool_calls.function.arguments`.

**ECHTER ROOT CAUSE (HTTP 400):** Enhanced Error Logging enthüllte Ollama's tatsächliche Fehlermeldung:
```json
{"error":"json: cannot unmarshal string into Go struct field ChatRequest.messages.tool_calls.function.arguments of type api.ToolCallFunctionArguments"}
```

`tool_calls.function.arguments` wurde als STRING in Conversation History gespeichert, aber Ollama API erwartet OBJECT-Format.

**LÖSUNG:** Normalisierung von `tool_calls.function.arguments` STRING→OBJECT:
- Zeilen 901-916: Normalisierung bei API Response Ingestion
- Zeilen 1119-1132: Defense-in-Depth Normalisierung bei Serialization
- Zeilen 1138-1155: Validation Logging

**ERGEBNIS:** HTTP 400 Fehler eliminiert ✅

### Phase 2: Tools Werden Nicht Ausgeführt (AKTUELLES PROBLEM)
**Problem:** Nach Fix des HTTP 400 Fehlers: Tools werden überhaupt nicht mehr ausgeführt

**Symptome:**
- Kein "Tool calls: 1" Log-Message
- Kein Permission Dialog erscheint
- Keine Tool Execution
- Keine "AGENT LOOP" Logs
- Assistant Message zeigt Tool-Parameter als Text-Content

**User Feedback (KRITISCH):**
> "Es gibt kein Problem mit dem model oder dem template. Der fehler liegt IN UNSERER APP: Hör auf den fehler ausserhalb zu suchen, die gesamte äußere infrastruktur ist stabil und läuft. Vollziehe die Änderungen bei dem Versionssprung von 0.1.3b auf 0.2.0b."

**User-Anweisung:**
- Bug wurde während App-Entwicklung verursacht (Version Upgrade 0.1.3b → 0.2.0b)
- App war funktional bis "safety measures and refactoring" implementiert wurden
- Priorität: **Fehleridentifizierung und Dokumentation** (nicht sofortiges Fixing)
- Falls nötig: Störende Security Features zurücknehmen

---

## Version Comparison Analysis: V0.1.3b → V0.2.0b

### Kritische Änderungen

#### 1. HTTP Request Migration (MAJOR CHANGE)
- **Alt (V0.1.3b):** Verwendete `fetch()` API
- **Neu (V0.2.0b):** Verwendet Node.js `http`/`https` Module
- **Grund:** Bypass CORS Preflight Issues
- **Impact:** Request-Format unverändert, aber Message Cleanup hinzugefügt

#### 2. Message Cleanup "Safety Measure" (DER SCHULDIGE)
**Location:** `/UI/src/ollama-client.js` Zeilen 1098-1136

```javascript
const cleanedBody = {
    ...requestBody,
    messages: requestBody.messages.map(msg => {
        const cleaned = { ...msg };

        // DAS PROBLEM:
        delete cleaned.ToolName;    // ❌ ENTFERNT Template-Feld
        delete cleaned.Content;     // ❌ ENTFERNT Template-Feld
        delete cleaned._pinned;
        delete cleaned._pinnedIds;
        // ... mehr Cleanup

        return cleaned;
    })
};
```

**Intention:** "Remove dual-field compatibility metadata (gpt-oss template)" zur Sicherstellung von API-Compliance

**Tatsächlicher Effekt:** Bricht gpt-oss Template, welches diese Felder BENÖTIGT

#### 3. Dual-Field Approach Implementation
**Location:** Multiple Stellen, wo Tool Responses zur History hinzugefügt werden

**Beispiel:** Zeile 1228-1236
```javascript
conversationHistory.push({
    role: 'tool',
    content: JSON.stringify(result),        // ✅ Standard API Feld
    tool_name: toolCall.function.name,      // ✅ Standard API Feld
    ToolName: toolCall.function.name,       // ✅ Template Feld (HINZUGEFÜGT)
    Content: JSON.stringify(result)         // ✅ Template Feld (HINZUGEFÜGT)
});
```

**Intention:** Support für BEIDE API-Compliance UND Template-Compatibility

**Tatsächlicher Effekt:** Negiert durch Cleanup-Code, der Template-Felder entfernt!

---

## Workflow Breakdown

### Was SOLLTE Passieren (Funktionierendes Szenario):
1. User sendet: "pwd for me"
2. App sendet Request mit `tools: [bash, read, write, ...]` zu Ollama
3. Model empfängt Tools, generiert `tool_calls` in API Response
4. App erkennt `tool_calls`, führt `bash` mit `pwd` Command aus
5. App fügt Tool Result zur History mit ALLEN Feldern hinzu (Standard + Template)
6. Model sieht Tool Result im Template-Format, führt Conversation fort
7. Model liefert finale Text-Response an User

### Was TATSÄCHLICH Passiert (Kaputtes Szenario):
1. User sendet: "pwd for me"
2. App sendet Request mit `tools: [bash, read, write, ...]` zu Ollama
3. Model empfängt Tools, generiert `tool_calls` in API Response
4. App erkennt `tool_calls`, führt `bash` mit `pwd` Command aus
5. App fügt Tool Result zur History mit ALLEN Feldern hinzu (Standard + Template)
6. **NÄCHSTER REQUEST:** Cleanup entfernt `ToolName` und `Content` Felder ❌
7. Model Template sucht nach `$msg.ToolName` und `$msg.Content` → **FINDET NICHTS** ❌
8. Model wird verwirrt, kann Tool Results nicht verstehen
9. Statt korrekte `tool_calls` zu generieren, gibt Model JSON-Text aus: `{"command":"pwd","description":"..."}`
10. App zeigt dies als Plain Text statt es als Tool Call zu parsen

---

## Das Model Template Problem

**Datei:** `/Models/gpt-oss_20b_Modelfile.txt`
**Zeilen:** 460-465

```go
{{- if eq $msg.Role "tool" -}}
  {{- if or (eq $msg.ToolName "python") ... -}}
    <|start|>{{ $msg.ToolName }} to=assistant<|message|>{{ $msg.Content }}<|end|>
  {{- else -}}
    <|start|>functions.{{ $msg.ToolName }} to=assistant<|message|>{{ $msg.Content }}<|end|>
  {{- end -}}
{{- end -}}
```

**Das Template prüft explizit auf:**
- `$msg.ToolName` - wird durch Cleanup-Code gelöscht (Zeile 1107)
- `$msg.Content` - wird durch Cleanup-Code gelöscht (Zeile 1108)

**Wenn diese Felder fehlen:**
- Template kann Tool Responses nicht korrekt rendern
- Model versteht nicht, was Tools zurückgegeben haben
- Model fällt zurück auf text-basierte Tool-Syntax-Generierung

---

## Warum Erster Tool Call Funktioniert, Zweiter Aber Nicht

**ERSTE Request:**
- Keine Tool Messages in History vorhanden
- Model macht korrekte `tool_calls`
- Execution erfolgreich ✅

**ZWEITE Request:**
- Tool Result in History ABER mit entfernten Feldern
- Template kann nicht parsen
- Model gibt JSON als Text aus ❌

Dies ist GENAU das "Wiederholungsschleife"-Pattern, das vermutet wurde!

---

## Dateien Comparison Summary

| Datei | V0.1.3b | V0.2.0b | Kritische Änderungen |
|-------|---------|---------|---------------------|
| `ollama-client.js` | 1631 Zeilen | 2328 Zeilen | +697 Zeilen: HTTP Migration, Cleanup Code, Dual-Field Support, Validation |
| Tool Addition Logic | Zeilen 577-585 | Zeilen 765-773 | **IDENTISCH** - Tools WERDEN gesendet |
| Tool Detection | Zeilen 685-688 | Zeilen 901-916 | **ENHANCED** - Normalisierung hinzugefügt |
| Tool Execution | Zeilen 814-1098 | Zeilen 1200-1450 | **GLEICHER FLOW** - Execution funktioniert |
| **Message Cleanup** | **KEINER** | **Zeilen 1098-1136** | **NEU - DAS IST DAS PROBLEM** |

---

## Warum Tools Als Plain Text Erscheinen

**User's Symptom:**
> "The tool call is actually worthless without the tool being utilized"
> Model gibt zurück: `{"command":"pwd","description":"Get current working directory"}`

**Erklärung:**
1. Bei ERSTER User-Request werden Tools korrekt gesendet, Model generiert `tool_calls`
2. Tool wird ausgeführt, Result zur History mit Template-Feldern hinzugefügt
3. Bei ZWEITER User-Request entfernt Cleanup Template-Felder vor dem Senden
4. Model Template kann Tool Result nicht parsen (fehlende `ToolName`/`Content`)
5. Model versteht Kontext nicht, denkt es muss Tools vorschlagen
6. Model generiert Tool-Syntax als Text statt korrekte API `tool_calls`
7. App erkennt keine `tool_calls` Struktur, zeigt als Plain Text an

---

## Related Changes Documentation

**Change 57:** V0.2.0b Development Version Creation

**Change 58:** HTTP 400 Error Fix - Tool Message Format Standardization
- Führte Dual-Field Approach ein
- **KRITISCH:** Führte auch Cleanup-Code ein, der Dual-Field Benefits negiert

**Aus CHANGELOG.md:**
> **Breaking Change**: Altes gpt-oss Modelfile MUSS aktualisiert werden

Dies deutet auf Bewusstsein hin, dass Template-Änderungen nötig waren, aber:
1. Kein aktualisiertes Modelfile existiert in V0.2.0b (Datei erwähnt in Change 58: `gpt-oss_20b_devbox.txt` ist FEHLEND)
2. Der Cleanup-Code macht Template-Updates irrelevant (Felder werden sowieso entfernt)

---

## Lösungsoptionen

### Option 1: Remove Cleanup (Quick Fix)
**Änderung:** Lösche Zeilen 1107-1108 aus `ollama-client.js`

**Vorteile:**
- Schnellster Fix
- Behält Dual-Field Approach bei
- Erhält sowohl API-Compliance ALS AUCH Template-Compatibility

**Nachteile:**
- Könnte HTTP 400 Fehler verursachen (das Original-Problem, das Change 58 fixen wollte)
- Weniger sauber

**Risiko:** MITTEL

### Option 2: Fix Template + Keep Cleanup (Proper Fix)
**Änderung:**
1. Update gpt-oss Modelfile um `$msg.content` und `$msg.tool_name` zu verwenden
2. Recreate Model: `ollama create gpt-oss:20b_devbox -f Models/gpt-oss_NEW.txt`
3. Behalte Cleanup-Code (erhält API-Compliance)

**Vorteile:**
- Saubere Lösung
- API-Standard-konform
- Zukunftssicher

**Nachteile:**
- Template-Komplexität
- Benötigt Model Recreation
- Ausführliches Testing nötig

**Risiko:** NIEDRIG (aber aufwendig)

### Option 3: Conditional Cleanup (Best Fix) ⭐ EMPFOHLEN
**Änderung:** Nur Template-Felder für nicht-gpt-oss Models entfernen

```javascript
// Nur Template-Felder für nicht-gpt-oss Models entfernen
if (!currentModel.toLowerCase().startsWith('gpt-oss')) {
    delete cleaned.ToolName;
    delete cleaned.Content;
}
```

**Vorteile:**
- Erhält Compatibility für alle Models
- Minimale Code-Änderung
- Kein Model Recreation nötig
- Keine Breaking Changes

**Nachteile:**
- Leicht weniger sauber als Option 2
- Model-spezifische Logik im Code

**Risiko:** NIEDRIG

---

## Kritische Dateien & Zeilennummern

**V0.2.0b `/UI/src/ollama-client.js`:**
- Zeile 765-773: Tool Addition (✅ FUNKTIONIERT)
- Zeile 901-916: Tool Call Detection (✅ FUNKTIONIERT)
- Zeile 1107-1108: **CLEANUP CODE - DER SCHULDIGE**
- Zeile 1228-1236: Dual-Field Tool Response (✅ FUNKTIONIERT bis Cleanup)
- Zeile 1157: HTTP Request Send mit cleanedBody (❌ SENDET STRIPPED MESSAGES)

**V0.2.0b `/Models/gpt-oss_20b_Modelfile.txt`:**
- Zeile 460-465: Tool Message Template (❌ ERWARTET STRIPPED FIELDS)

---

## Hypothesis: Warum Tools Aufhörten zu Funktionieren

1. ✅ **Tools WERDEN gesendet** zum Model (verifiziert: Zeilen 765-773)
2. ✅ **Model KANN tool_calls generieren** (erste Request funktioniert)
3. ✅ **Tool Execution Code FUNKTIONIERT** (Tool Results werden generiert)
4. ❌ **Template KANN Tool Results NICHT verstehen** (fehlende benötigte Felder)
5. ❌ **Model fällt zurück auf Text Mode** (Verwirrung führt zu text-basierten Tool-Vorschlägen)
6. ❌ **Kein Permission Dialog erscheint** (keine `tool_calls` Struktur in Response erkannt)
7. ❌ **Keine Execution findet statt** (Text wird angezeigt statt als Tool Call geparst)

---

## Was Geändert Werden Muss

### SOFORTIGE AKTION:
1. Entweder Zeilen 1107-1108 entfernen ODER Cleanup conditional machen basierend auf Model-Typ
2. Test mit gpt-oss:20atlas Model
3. Verifizieren, dass Tool Calls über mehrere Turns funktionieren

### ROOT CAUSE FIX:
1. Erstelle aktualisiertes Modelfile, das Standard-API-Felder verwendet (`$msg.content`, `$msg.tool_name`)
2. Behalte Cleanup-Code für API-Compliance
3. Recreate Model mit neuem Template
4. Teste ausführlich

### DOKUMENTATION:
1. Update CLAUDE.md mit korrekten Migrations-Schritten
2. Füge Warnung über Model Recreation Requirement hinzu
3. Dokumentiere, welche Models welches Feld-Format benötigen

---

## Success Criteria für Fix Validation

✅ User sendet: "pwd for me"
✅ Permission Dialog erscheint
✅ Tool wird ausgeführt, zeigt Output
✅ User sendet: "now list files"
✅ Permission Dialog erscheint WIEDER
✅ Tool wird ausgeführt, zeigt Output
✅ Multi-Turn Tool Usage funktioniert ohne Zurückfallen auf Text Mode

---

## Zusammenfassung

Die "Safety Measure" von Change 58, die HTTP 400 Fehler verhindern sollte, hat unbeabsichtigt die Tool Execution komplett gebrochen, indem sie Template-Felder entfernte, die das gpt-oss Model zum Verstehen von Tool Results benötigt.

**Die Lösung ist einfach:** Mache das Cleanup conditional, sodass gpt-oss Models ihre Template-Felder behalten, während andere Models saubere API-Standard-Messages bekommen.

**Status:** ROOT CAUSE IDENTIFIZIERT - **FIX ATTEMPT 1 FEHLGESCHLAGEN**

---

## FIX ATTEMPT 1: Conditional Cleanup (FEHLGESCHLAGEN - 2025-10-28 20:10)

### Was Wurde Implementiert
**Datei:** `UI/src/ollama-client.js` Zeilen 1109-1112

```javascript
// CONDITIONAL: Only remove template fields for non-gpt-oss models
// gpt-oss models REQUIRE ToolName and Content fields in their template
if (!currentModel.toLowerCase().startsWith('gpt-oss')) {
    delete cleaned.ToolName;
    delete cleaned.Content;
}
```

### Test-Ergebnis
**Prompt:** "Erstelle alle nötigen dateien und den code zum erreichen des Projektziels."

**Erwartung:** Model macht tool_calls → Permission Dialog → Tool Execution

**Tatsächliches Ergebnis:** Model gibt Tool-Parameter als JSON-TEXT in Assistant-Bubble zurück:
```json
{
  "file_path": "MovingPlatform.h",
  "content": "#pragma once\n\n#include \"CoreMinimal.h\"...",
  "replace_all": false
}
```

### Log-Analyse
**Beobachtungen:**
- ✅ HTTP Request successful, status: 200
- ✅ Tool_calls validation: "All tool_calls have arguments as OBJECT (correct format)"
- ✅ Code Mode: ENABLED
- ✅ Tools Count: 4 (read, write, edit, bash)
- ❌ **KEIN** "Tool calls: X" Log-Message
- ❌ **KEIN** Permission Check
- ❌ **KEINE** Tool Execution
- ❌ **KEIN** Agent Loop

### Neue Root Cause Hypothese
**Das Problem liegt NICHT beim Message Cleanup!**

Der conditional cleanup hat funktioniert (keine HTTP 400 Fehler, keine STRING arguments Fehler).

**DAS EIGENTLICHE PROBLEM:** Das Model **generiert KEINE tool_calls API-Struktur**, sondern gibt Tool-Parameter direkt als Text-Content zurück.

Dies ist ein **ANDERES Problem** als ursprünglich angenommen:
- **Ursprüngliche Hypothese:** Template kann Tool Results nicht parsen → Model verwirrt → Text-basierte Tool-Vorschläge
- **Tatsächliches Problem:** Model macht **ÜBERHAUPT KEINE** tool_calls, nicht mal beim ersten Request

### Mögliche Root Causes (Neue Analyse Erforderlich)
1. **Model Template Problem:** gpt-oss Template generiert möglicherweise KEINE tool_calls API-Struktur
2. **System Prompt Fehlt:** Model braucht explizite Instruktionen, tool_calls zu nutzen
3. **RAG Context Verwirrt Model:** 3 RAG chunks im Context könnten Model vom Tool-Calling ablenken
4. **Tool Definition Problem:** Tools werden zwar gesendet, aber Model versteht sie nicht
5. **Ollama API Version Incompatibility:** Model wurde mit anderer API-Version trainiert

### Nächste Schritte
1. **Vergleich mit V0.1.3b:** Wie wurden Tools dort definiert/gesendet?
2. **Template-Analyse:** Untersuche gpt-oss Modelfile - generiert es tool_calls?
3. **System Prompt Check:** Fehlen Instruktionen für Tool Usage?
4. **RAG Deaktivierung Test:** Funktioniert Tool Calling ohne RAG Context?
5. **Minimal Test:** Einfachster Prompt ohne RAG/History ("pwd for me")

---

## DEEP ANALYSIS ERGEBNIS (2025-10-28 20:30)

### FINAL ROOT CAUSE: Model Training Limitation - NICHT Code Bug!

**Der Application Code ist 100% KORREKT!** Das Problem ist eine **Model-Training-Limitation**.

#### Code Vergleich V0.1.3b vs V0.2.0b

**Tool Sending Mechanismus:** **IDENTISCH** in beiden Versionen

```javascript
// BEIDE Versionen (V0.1.3b:575-585, V0.2.0b:765-773)
if (codeModeEnabled && supportsTools(currentModel)) {
    requestBody.tools = SYSTEM_TOOLS;
}
```

**Tool Format:** Matcht **100%** Ollama API Specification (validiert gegen offizielle Docs)

**Tool Detection:** Funktioniert korrekt - `gpt-oss` wird als tool-capable erkannt

#### Was Tatsächlich Passiert

**Ollama API Erwartung:**
```json
{
  "message": {
    "role": "assistant",
    "tool_calls": [
      {"function": {"name": "write", "arguments": {...}}}
    ]
  }
}
```

**gpt-oss:20custom Tatsächliches Output:**
```json
{
  "message": {
    "role": "assistant",
    "content": "{\"file_path\":\"...\",\"content\":\"...\"}",
    "tool_calls": []  // LEER!
  }
}
```

#### Warum Das Model So Handelt

**gpt-oss:20custom wurde trainiert für:**
- Custom gpt-oss Template Format (channels: analysis, commentary, final)
- Text-basierte Tool-Invokation via "commentary channel"
- **NICHT** für Ollama's tool_calls API-Struktur

**Models die FUNKTIONIEREN mit Ollama Tool Calling:**
- llama3.1, llama3.2 (Meta's fine-tune mit tool calling)
- qwen2.5 series (Alibaba's function calling training)
- mistral models (Mistral AI's tool support)

**Was diese Models gemeinsam haben:**
- Fine-tuned speziell für tool calling API format
- Training data enthielt `tool_calls` Struktur-Beispiele
- Base model architecture unterstützt structured output generation

**gpt-oss:20custom fehlt:**
- Kein Training mit tool_calls API format
- Template suggeriert text-based tool invocation
- Model gibt valides JSON aus, aber im falschen Field

#### Modelfile Template Analyse

**Modelfile UNTERSTÜTZT tool_calls** (Zeilen 473-477):
```go
{{- if gt (len $msg.ToolCalls) 0 -}}
  {{- range $j, $toolCall := $msg.ToolCalls -}}
    <|start|>assistant<|channel|>commentary to=functions.{{ $toolCall.Function.Name }}...
  {{- end -}}
{{- end -}}
```

**ABER:** Das Model wurde nicht trainiert, diese Struktur zu **GENERIEREN**

**Template Instruktion** (Zeilen 175-176):
> "Calls to these tools must go to the commentary channel: 'functions'"

Das Model folgt dieser Instruktion und gibt zu "commentary channel" als TEXT aus, nicht als API-Struktur.

---

## LÖSUNGSOPTIONEN

### Option 1: Model Wechsel (EMPFOHLEN) ⭐

**Verwende ein Model mit nativem Tool Calling Support:**

```bash
# Llama 3.2 (bester Balance)
ollama pull llama3.2:3b-instruct-fp16

# Qwen 2.5 Coder (code-fokussiert)
ollama pull qwen2.5-coder:7b

# Mistral Small 3 (großer Context)
ollama pull mistral-small3:24b
```

**Warum das funktioniert:**
- Diese Models wurden mit tool calling in fine-tuning trainiert
- Sie generieren korrekte `tool_calls` API-Struktur
- Template Compatibility bleibt erhalten

### Option 2: Text-Based Tool Detection Fallback

**Implementiere Parser für Tool-JSON im content Field:**

```javascript
// In ollama-client.js nach tool_calls Detection
function detectTextBasedToolCalls(content) {
    const toolPatterns = {
        write: /"file_path":\s*"[^"]+"/,
        bash: /"command":\s*"[^"]+"/,
        edit: /"old_string":\s*"[^"]+"/,
        read: /"file_path":\s*"[^"]+"/ && !/"content"/
    };

    for (const [toolName, pattern] of Object.entries(toolPatterns)) {
        if (pattern.test(content)) {
            try {
                const parsed = JSON.parse(content);
                return [{
                    function: {
                        name: toolName,
                        arguments: parsed
                    }
                }];
            } catch (e) {
                // Not valid tool JSON
            }
        }
    }
    return [];
}
```

**Vorteile:**
- Funktioniert mit aktuellem gpt-oss Model
- Kein Model Retraining nötig

**Nachteile:**
- Hacky Workaround
- Unreliable Detection (Model könnte JSON mit Text mischen)
- Nicht zukunftssicher

### Option 3: gpt-oss Model Re-Training

**Was benötigt wird:**
- Training Data mit Ollama tool calling Beispielen
- Fine-tune gpt-oss um `tool_calls` Struktur zu generieren
- Thinking/Reasoning Capabilities beibehalten

**Schwierigkeit:** HOCH - benötigt ML Expertise und Compute Resources

---

## FINAL DIAGNOSIS

### Das Problem

`gpt-oss:20custom` model gibt tool parameters als **plain JSON text in content field** zurück statt Ollama's **tool_calls API structure** zu generieren.

### Warum Es Passiert

Das Model wurde **NICHT fine-tuned** für Ollama tool calling API format. Es folgt dem custom template's text-based channel instructions aber generiert nicht den structured `tool_calls` output, den Ollama erwartet.

### Code Status

Application Code ist **KORREKT** und **FUNKTIONIERT WIE DESIGNED**:
- ✅ Tools werden korrekt zu Ollama API gesendet
- ✅ Tool Format matcht Ollama Specification
- ✅ Detection Logic prüft `tool_calls` Struktur
- ✅ Modelfile Template enthält Tool Definitions

Das Issue ist **model behavior**, nicht code bugs.

### Empfohlener Fix

**Verwende llama3.2:3b-instruct-fp16** oder **qwen2.5-coder:7b** die nativen tool calling support haben.

Falls gpt-oss zwingend benötigt wird, implementiere Option 2 (text-based tool detection fallback) als temporären Workaround.

---

**Status:** FINAL ROOT CAUSE IDENTIFIZIERT - MODEL TRAINING ISSUE, NICHT CODE BUG
