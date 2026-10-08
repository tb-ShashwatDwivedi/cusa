# Custom Windows Agent ↔ Wazuh Manager: Developer Guide

How a Windows agent talks to the Wazuh manager, how Windows events are decoded, which rules fire on them, and the exact JSON the manager expects. Written against **this** manager:

| | |
|---|---|
| Manager | `nishi-sharma`, Wazuh **v4.11.2**, install path `/var/ossec` |
| Agent port | `1514/tcp` (`<connection>secure</connection>`) |
| Enrollment port | `1515/tcp` (`wazuh-authd`) |
| Archiving | `logall` and `logall_json` are **on**, so every event that reaches the analysis engine is written to `logs/archives/archives.{log,json}`, whether or not a rule fires |

Statements marked **[verified]** were checked against this manager's logs, ruleset, or database on 2026-10-08. Statements marked **[source]** describe Wazuh 4.x protocol behaviour from the upstream source code and were not re-verified here; confirm them by capturing a stock agent (section 9) before relying on byte-level details.

---

## 1. Why the custom agent's logs are "not received" (read this first)

The custom agent is `T-LT-0107`, **agent ID 019**, which connected from `192.168.7.21` between 12:52 and 12:56 on 2026-10-08. The connection, key, and encryption are working. Three things are wrong with what it sends. **[verified]**

### Problem 1: EventChannel events have no `Event` field, so they are dropped

`ossec.log` has 2,600 of these lines, all between 12:52 and 12:54, which is exactly the window when agent 019 was connected:

```
wazuh-analysisd winevtchannel.c:129 at DecodeWinevt(): DEBUG: Malformed JSON received. No 'Event' field found.
```

The Windows event decoder requires a JSON object with an `Event` key holding the **raw Windows event XML as a string**. If that key is missing, the event is discarded. It is not archived and produces no alert; the only trace is the DEBUG line above. The attribution to agent 019 is by timing (the log line does not name the agent), but no other agent produced this error all day.

**Fix:** send the payload described in section 4.

### Problem 2: the other events use a private JSON shape that no rule understands

600 events did reach the archive, all looking like this:

```
2026 Oct 08 12:53:39 (T-LT-0107) any->agent {"path":"C:\\Users\\shashwat.dwivedi\\.cusa\\state\\state.json","type":"modification"}
```

They arrived with location `agent`, were decoded by the generic `json` decoder into `data.path` and `data.type`, and matched no rule. So they sit in `archives.json` and never become alerts, which is why they never show up in the dashboard's alert views.

**Fix:** either send real FIM (syscheck) messages, or keep this shape and add custom rules for it (section 7).

### Problem 3: the keepalive is malformed, so the manager knows nothing about the agent

Every 10 seconds while connected:

```
wazuh-remoted manager.c:346 at save_controlmsg(): WARNING: Invalid message from agent: 'T-LT-0107' (019)
wazuh-remoted manager.c:461 at save_controlmsg(): ERROR: Error getting group for agent '019'
```

Result in the manager database for agent 019: OS, version, config checksum, and group are all `NULL`, and the agent has no group membership. Compare the stock agent 003, which shows `Microsoft Windows 11 Pro`, platform `windows`, `Wazuh v4.11.2`, group `default`.

**Fix:** send the keepalive in the format in section 3.3.

The first two seconds after enrollment also logged `(1408): Invalid ID 019 for the source ip`. That is only the manager not having reloaded `client.keys` yet. Retry after a short delay; it is not a bug.

---

## 2. End-to-end pipeline

```
 WINDOWS ENDPOINT                                   MANAGER (/var/ossec)
┌────────────────────────┐                ┌──────────────────────────────────────────┐
│ Event Log API          │                │ wazuh-authd :1515   enrollment, issues key│
│  EvtSubscribe/EvtRender│                │                                          │
│        │               │                │ wazuh-remoted :1514                      │
│  build payload         │   TCP 1514     │   decrypt, check agent ID + counters     │
│  f:EventChannel:{...}  │ ─────────────► │   handle control msgs (startup/keepalive)│
│        │               │  AES + zlib    │   prefix event with agent identity       │
│  compress + encrypt    │                │        │  unix socket queue/sockets/queue│
│  length-prefixed frame │ ◄───────────── │        ▼                                 │
└────────────────────────┘   ACK, config  │ wazuh-analysisd                          │
                                          │   1. pre-decode (queue, agent, location) │
                                          │   2. decode   (winevtchannel.c for 'f')  │
                                          │   3. rule matching (60000 → children)    │
                                          │        │                                 │
                                          │        ├─► logs/archives/archives.json   │
                                          │        │     (every event, logall=yes)   │
                                          │        └─► logs/alerts/alerts.json       │
                                          │              (rule level >= 3 only)      │
                                          │                    │                     │
                                          │              Filebeat → indexer → UI     │
                                          └──────────────────────────────────────────┘
```

An event can be lost at four points, and each leaves a different trace:

| Lost at | Symptom | Where to look |
|---|---|---|
| Transport/crypto | Agent never becomes `Active` | `ossec.log`, `wazuh-remoted` lines |
| Decoder rejects payload | Nothing in archives | `ossec.log`, `winevtchannel.c` DEBUG lines (needs `analysisd.debug=2`) |
| Decoded, no rule matches | In `archives.json`, not in `alerts.json` | `archives.json`, check `decoder.name` and `data` |
| Rule matched at level < 3 | In archives with a `rule` block, not in alerts | `<log_alert_level>3</log_alert_level>` in `ossec.conf` |

---

## 3. Agent ↔ manager protocol

### 3.1 Enrollment (port 1515) **[source]**

TLS connection to `wazuh-authd`. The agent sends one line and gets one back:

```
→ OSSEC A:'T-LT-0107'\n                       (optionally: OSSEC PASS: <pw> OSSEC A:'name' G:'group' IP:'src'\n)
← OSSEC K:'019 T-LT-0107 any <64-hex-key>'\n
```

The four fields (`id name ip key`) are what the stock agent stores in `client.keys`. Adding `G:'default'` at enrollment assigns the group up front and avoids the "Error getting group" problem.

Agent 019 was registered locally on the manager (`Agent key generated for agent 'T-LT-0107' (requested locally)`), which is why it has no group.

### 3.2 Secure message framing (port 1514/tcp) **[source]**

The agent already does this correctly, since it connects and its events decrypt. For reference:

```
TCP frame   = <uint32 little-endian length> <payload>
payload     = "!" <agent_id> "!#AES:" <ciphertext>
ciphertext  = AES-256-CBC( key, iv = "FEDCBA0987654321", padded )
padded      = N × "!" + zlib_compressed        (N = 8 - len % 8, so 1..8)
zlib_input  = md5hex(body) + body
body        = <5-digit random> <10-digit global counter> ":" <4-digit local counter> ":" <message>
key         = first 32 bytes of: md5hex(agent_key) + first 15 chars of md5hex( md5hex(name) + md5hex(id) )
```

Counters must increase monotonically across reconnects (persist them). This manager runs with `remoted.verify_msg_id=0`, so stale counters are tolerated here, but a manager with verification on will silently drop replayed counters.

Maximum message size is 65,536 bytes. Truncate oversized events on the agent.

### 3.3 Control messages **[source, symptoms verified]**

Control messages are ordinary encrypted messages whose `<message>` starts with `#!-`.

**Startup** (once per connection; the manager did accept this one from agent 019):

```
→ #!-agent startup {"version":"v4.11.2"}
← #!-agent ack
```

**Keepalive** (every 10 s by default; the manager marks the agent disconnected after 10 minutes of silence, per `agents_disconnection_time`):

```
#!-Microsoft Windows 11 Pro [Ver: 10.0.26100.2033] - Wazuh v4.11.2 / ab73af41699f13fdd81903b5f23d8d00
cb5dc59d195320bb20b6039a519a8c0e merged.mg
#"_agent_ip":192.168.7.21
```

Line by line:

1. `#!-` + OS string + ` - Wazuh v<version>` + ` / ` + MD5 of the agent's own config. The OS string must follow the stock Windows form `Microsoft Windows <edition> [Ver: <major>.<minor>.<build>.<rev>]` for the manager to set `os_platform=windows`.
2. `<md5> merged.mg`: MD5 of the shared-config bundle the agent currently holds. The manager uses this line to work out the agent's group.
3. `#"_agent_ip":<ip>`: the agent's own IP.

Each line ends in `\n`. **"Invalid message from agent" is logged when the keepalive contains no newline at all**, which means agent 019 is sending a single-line keepalive. "Error getting group" follows because there is no `merged.mg` line and no group assigned.

Agent 009 (`T-LT-0101`, an earlier build) sent a Linux-style uname and was recorded as `os_name=Windows_NT`, `os_platform=win32`. That is not recognised as Windows; use the format above.

**Shared config push.** If the `merged.mg` MD5 does not match the group's bundle, the manager sends it after each keepalive:

```
← #!-up file <md5> merged.mg\n<chunk>...
← #!-close file merged.mg
```

Store what you receive and report its MD5 in the next keepalive, otherwise the manager re-sends it every 10 seconds. The `default` group's `agent.conf` on this manager is empty, so there is nothing to apply yet.

**Shutdown:** `#!-agent shutdown ` (trailing space).

**Manager-side stopgap** while the keepalive is being fixed (not applied; run on the manager if wanted):

```bash
/var/ossec/bin/agent_groups -a -i 019 -g default -q
```

### 3.4 Event messages **[verified from archives, queue IDs from source]**

Every non-control message has the form:

```
<queue>:<location>:<log>
```

`<queue>` is a single character that selects the decoder path on the manager. `<location>` must not contain a colon followed by content the manager could misparse; the stock agent escapes `:` in Windows paths as `|:`.

| Queue | Location | Purpose | Decoder on manager |
|---|---|---|---|
| `f` | `EventChannel` | Windows event channel events | `windows_eventchannel` (built-in C) |
| `1` | file path or command | Plain log lines (localfile) | XML decoders, or `json` if the line is JSON |
| `8` | `syscheck` | File integrity monitoring | `syscheck_*` |
| `9` | `rootcheck` | Rootcheck | `rootcheck` |
| `d` | `syscollector` | Inventory | `syscollector` |
| `p` | `sca` | Security configuration assessment | `sca` |
| `5` | component name | DB sync | (internal) |

`remoted` rewrites the message before handing it to the analysis engine, adding the agent identity:

```
f:[019] (T-LT-0107) any->EventChannel:{...}
```

That is why archives show `(T-LT-0107) any->agent`: name, registered IP (`any`), then the location the agent chose.

---

## 4. The Windows event payload (what to send)

### 4.1 Wire format **[verified]**

```
f:EventChannel:{"Message":"<rendered message text>","Event":"<raw event XML>"}
```

- **`Event`** (required): the event exactly as `EvtRender(..., EvtRenderEventXml, ...)` returns it, as one JSON string. Missing `Event` is the error in section 1.
- **`Message`** (optional but used by 15 stock rules and shown in the UI): the output of `EvtFormatMessage(..., EvtFormatMessageEvent, ...)`.

`EvtRender` emits single-quoted XML attributes, so the XML needs little JSON escaping. Still run it through a real JSON serializer: backslashes, double quotes, and control characters (`\r\n\t` in `Message`) must be escaped.

Complete example for a failed logon (4625):

```json
{
  "Message": "An account failed to log on.\r\n\r\nSubject:\r\n\tSecurity ID:\t\tS-1-0-0\r\n...",
  "Event": "<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Microsoft-Windows-Security-Auditing' Guid='{54849625-5478-4994-a5ba-3e3b0328c30d}'/><EventID>4625</EventID><Version>0</Version><Level>0</Level><Task>12544</Task><Opcode>0</Opcode><Keywords>0x8010000000000000</Keywords><TimeCreated SystemTime='2026-10-08T07:23:11.1234567Z'/><EventRecordID>1037999</EventRecordID><Correlation ActivityID='{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}'/><Execution ProcessID='884' ThreadID='4321'/><Channel>Security</Channel><Computer>T-LT-0107.tech-bridge.biz</Computer><Security/></System><EventData><Data Name='SubjectUserSid'>S-1-0-0</Data><Data Name='TargetUserName'>administrator</Data><Data Name='TargetDomainName'>TECH-BRIDGE</Data><Data Name='Status'>0xc000006d</Data><Data Name='SubStatus'>0xc000006a</Data><Data Name='LogonType'>3</Data><Data Name='WorkstationName'>ATTACKER-PC</Data><Data Name='IpAddress'>192.168.0.99</Data><Data Name='IpPort'>51234</Data></EventData></Event>"
}
```

On the wire this is one line with no pretty-printing, prefixed with `f:EventChannel:`.

### 4.2 How the manager turns XML into fields **[verified against live output; mapping details from source]**

There is **no XML decoder file** for this. The `windows_eventchannel` decoder is compiled into `wazuh-analysisd` (`winevtchannel.c`). `ruleset/decoders/0380-windows_decoders.xml` only covers the legacy `eventlog` text format, IIS, Windows Firewall text logs, DHCP, and old Sysmon text. Nothing in it applies to EventChannel events.

The decoder walks the XML and builds `win.system` and `win.eventdata`:

| XML | Field | Note |
|---|---|---|
| `<Provider Name=…>` | `win.system.providerName` | **Required by root rule 60000** |
| `<Provider Guid=…>` | `win.system.providerGuid` | |
| `<Provider EventSourceName=…>` | `win.system.eventSourceName` | |
| `<EventID>` | `win.system.eventID` | String. Used by 732 rule conditions |
| `<Version>` | `win.system.version` | |
| `<Level>` | `win.system.level` | Feeds `severityValue` |
| `<Task>` | `win.system.task` | |
| `<Opcode>` | `win.system.opcode` | |
| `<Keywords>` | `win.system.keywords` | Feeds `severityValue` |
| `<TimeCreated SystemTime=…>` | `win.system.systemTime` | |
| `<EventRecordID>` | `win.system.eventRecordID` | |
| `<Execution ProcessID= ThreadID=>` | `win.system.processID`, `threadID` | |
| `<Channel>` | `win.system.channel` | Drives rule routing |
| `<Computer>` | `win.system.computer` | |
| JSON `Message` | `win.system.message` | Stored wrapped in literal double quotes |
| derived | `win.system.severityValue` | See below |
| `<Data Name='TargetUserName'>` | `win.eventdata.targetUserName` | **First letter lower-cased** |
| `<UserData>` subtree | `win.<childElement>.<field>` | For events without `EventData` |

`severityValue` is computed on the manager from `Level` and `Keywords`, so both must be present and correct:

| `Level` | `Keywords` bit | `severityValue` |
|---|---|---|
| 1 | | `CRITICAL` |
| 2 | | `ERROR` |
| 3 | | `WARNING` |
| 4 | | `INFORMATION` |
| 5 | | `VERBOSE` |
| 0 | `0x0020000000000000` set | `AUDIT_SUCCESS` |
| 0 | `0x0010000000000000` set | `AUDIT_FAILURE` |

Do not rename, re-case, or pre-flatten fields on the agent. Rules match the names the manager derives, for example `win.eventdata.logonType`, not `LogonType`.

### 4.3 What it looks like after decoding **[verified, real event from agent 003]**

`archives.json` / `alerts.json` entry (message shortened):

```json
{
  "timestamp": "2026-10-08T09:41:34.381+0530",
  "rule": { "level": 3, "description": "A process was created.", "id": "67027", "groups": ["windows", " WEF"] },
  "agent": { "id": "003", "name": "T-LT-0368", "ip": "192.168.1.158" },
  "manager": { "name": "nishi-sharma" },
  "decoder": { "name": "windows_eventchannel" },
  "data": {
    "win": {
      "system": {
        "providerName": "Microsoft-Windows-Security-Auditing",
        "providerGuid": "{54849625-5478-4994-a5ba-3e3b0328c30d}",
        "eventID": "4688",
        "version": "2",
        "level": "0",
        "task": "13312",
        "opcode": "0",
        "keywords": "0x8020000000000000",
        "systemTime": "2026-10-07T17:42:24.7886373Z",
        "eventRecordID": "1037488",
        "processID": "4",
        "threadID": "19932",
        "channel": "Security",
        "computer": "T-LT-0368.tech-bridge.biz",
        "severityValue": "AUDIT_SUCCESS",
        "message": "\"A new process has been created.\r\n\r\nCreator Subject:...\""
      },
      "eventdata": {
        "subjectUserSid": "S-1-5-18",
        "subjectUserName": "T-LT-0368$",
        "subjectDomainName": "TECH-BRIDGE",
        "subjectLogonId": "0x3e7",
        "newProcessId": "0x4ec0",
        "newProcessName": "C:\\\\Users\\\\nishi.sharma\\\\AppData\\\\Local\\\\BraveSoftware\\\\Update\\\\BraveUpdate.exe",
        "tokenElevationType": "%%1936",
        "processId": "0xac0",
        "targetUserName": "nishi.sharma",
        "parentProcessName": "C:\\\\Windows\\\\System32\\\\svchost.exe",
        "mandatoryLabel": "S-1-16-8192"
      }
    }
  },
  "location": "EventChannel"
}
```

All values are strings. Backslashes in `eventdata` come out doubled by the manager; stock rules are written for that (rule 92650 matches `^%systemroot%\\\\\w+\.exe$`), so send single backslashes in the XML and let the manager do it.

A correct custom agent produces `"decoder":{"name":"windows_eventchannel"}` and `"location":"EventChannel"`. Today agent 019 produces `"decoder":{"name":"json"}` and `"location":"agent"`.

---

## 5. Windows rules on this manager **[verified]**

### 5.1 How routing works

Every EventChannel rule descends from one root in `ruleset/rules/0575-win-base_rules.xml`:

```xml
<rule id="60000" level="0">
  <category>ossec</category>
  <decoded_as>windows_eventchannel</decoded_as>
  <field name="win.system.providerName">\.+</field>
</rule>
```

Two conditions: decoded by `windows_eventchannel`, and `providerName` non-empty. If either fails, **no Windows rule can fire**. Children then split by channel and severity:

```
60000  windows_eventchannel + providerName
 ├─ 60001  channel = Security
 │    ├─ 60103  severityValue = AUDIT_SUCCESS
 │    │    ├─ 60106  eventID 4624/4769...        Windows Logon Success (3)
 │    │    │    └─ 60118  logonType 2            Workstation Logon Success (3)
 │    │    ├─ 60109  eventID 4720/4722           User account enabled or created (8)
 │    │    ├─ 60110  eventID 4738/4781           User account changed (8)
 │    │    └─ 67027  eventID 4688                A process was created (3)
 │    └─ 60104  severityValue = AUDIT_FAILURE    Windows audit failure event (5)
 │         ├─ 60105  eventID 4625...             Windows Logon Failure (5)
 │         │    └─ 60122  eventID 4625           Unknown user or bad password (5)
 │         │         └─ 60204  frequency, same ipAddress   Multiple Logon Failures (10)
 │         └─ 60107  eventID 4673                Failed privileged operation (4)
 ├─ 60002  channel = System
 │    ├─ 61102  severityValue = ERROR            Windows System error event (5)
 │    └─ 61138  eventID 7045                     New Windows Service Created (5)
 │         └─ 92650  imagePath in %systemroot%   Suspicious service (12)
 ├─ 60003  channel = Application
 ├─ 60004  channel = Microsoft-Windows-Sysmon/Operational
 │    └─ 61603  eventID 1 → 92000+ process-creation detections
 ├─ 60005  channel = Microsoft-Windows-Windows Defender/Operational
 │    └─ 62123  eventID 1116                     Antimalware detection (12)
 ├─ 60016  channel = ...Windows Firewall With Advanced Security/Firewall
 ├─ 91801  channel = Microsoft-Windows-PowerShell/Operational
 └─ 60009..60012  fallback by severityValue: INFORMATION(0) WARNING(0) ERROR(5) CRITICAL(10)
```

Numbers in parentheses are rule levels. Only level 3 and above reach `alerts.json`.

Channel names are matched **exactly, case-sensitively, anchored** (`^Security$`). Send the channel exactly as Windows reports it.

### 5.2 Rule files

| File (`/var/ossec/ruleset/rules/`) | Rule IDs | Rules | Covers |
|---|---|---|---|
| `0575-win-base_rules.xml` | 60000–60015 | 19 | Root rule, channel and severity routing |
| `0580-win-security_rules.xml` | 60100–60231 | 129 | Security channel: logons, accounts, groups, policy, Kerberos |
| `0585-win-application_rules.xml` | 60600–61072 | 473 | Application channel: MSSQL, Office, installers, app errors |
| `0590-win-system_rules.xml` | 61100–61138 | 39 | System channel: services, time changes, shutdowns |
| `0595-win-sysmon_rules.xml` | 61600–61643 | 56 | Sysmon event ID grouping |
| `0600-win-wdefender_rules.xml` | 62100–62212 | 113 | Windows Defender |
| `0602-win-wfirewall_rules.xml` | 67001–67010 | 10 | Windows Firewall channel |
| `0601-win-vipre_rules.xml` | 90499–90565 | 67 | VIPRE AV |
| `0605-win-mcafee_rules.xml` | 62600–62618 | 19 | McAfee (Application channel, provider `McLogEvent`) |
| `0610-win-ms_logs_rules.xml` | 63100–63107 | 11 | Event log cleared and similar |
| `0615-win-ms-se_rules.xml` | 63600–63618 | 19 | Microsoft Security Essentials |
| `0620-win-generic_rules.xml` | 64100–64110 | 11 | Generic fallbacks |
| `0800-sysmon_id_1.xml` | 92000–92081 | 82 | Sysmon 1, process creation (MITRE mapped) |
| `0810-sysmon_id_3.xml` | 92101–92110 | 10 | Sysmon 3, network connection |
| `0820-sysmon_id_7.xml` | 92151–92157 | 7 | Sysmon 7, image load |
| `0830-sysmon_id_11.xml` | 92200–92227 | 28 | Sysmon 11, file create |
| `0840-win_event_channel.xml` | 92650–92657 | 8 | Cross-channel detections |
| `0860-sysmon_id_13.xml` | 92300–92309 | 10 | Sysmon 13, registry value set |
| `0870-sysmon_id_8.xml` | 92400–92403 | 4 | Sysmon 8, remote thread |
| `0915-win-powershell_rules.xml` | 91801–91846 | 45 | PowerShell operational, script block logging |
| `0945-sysmon_id_10.xml` | 92900–92920 | 3 | Sysmon 10, process access |
| `0950-sysmon_id_20.xml` | 89501–89502 | 2 | Sysmon 20, WMI consumer |
| `0955-WEF-baseline_rules.xml` | 67027 and others | | Windows Event Forwarding baseline |

Site-specific Windows rules live in `/var/ossec/etc/rules/`: `windows_audit_policy_rules.xml`, `windows_powershell_rules.xml`, `rdp_lateral_movement_rules.xml`, `password_spray_rules.xml`, `lotl_data_exfiltration.xml`. They hang off the same 60000 tree, so they start working for the custom agent as soon as its events decode as `windows_eventchannel`.

Legacy, **not** applicable to EventChannel: `0220-msauth_rules.xml` (18100–18160) and `0330-sysmon_rules.xml` need the old `eventlog` text format and the `windows` decoder.

### 5.3 Fields the rules depend on most

Count of rule conditions per field across the stock Windows ruleset:

| Field | Conditions |
|---|---|
| `win.system.eventID` | 732 |
| `win.system.providerName` | 57 |
| `win.eventdata.image` | 53 |
| `win.eventdata.errorCode` | 51 |
| `win.eventdata.commandLine` | 50 |
| `win.eventdata.scriptBlockText` | 42 |
| `win.system.severityValue` | 39 |
| `win.eventdata.targetSid` | 39 |
| `win.eventdata.parentImage` | 29 |
| `win.eventdata.originalFileName` | 29 |
| `win.eventdata.targetFilename` | 21 |
| `win.system.message` | 15 |
| `win.system.channel` | 9 (but they are the routing rules) |

Minimum for anything to fire: `Provider Name`, `EventID`, `Level`, `Keywords`, `Channel`, plus the full `EventData`.

---

## 6. What a stock Windows agent sends from this environment **[verified]**

Agent 003 (`T-LT-0368`, stock Wazuh 4.11.2 on Windows 11) today:

| Location | Decoder | Events |
|---|---|---|
| `EventChannel` | `windows_eventchannel` | 5,826 (Security 5,523, Application 186, System 135) |
| `syscollector` | `syscollector` | 1,213 |
| `syscheck` | `syscheck_registry_*` | 137 |
| `sca` | `sca` | 4 |
| `rootcheck` | `rootcheck` | 4 |

For parity with the stock agent's default config, subscribe to `Security`, `System`, and `Application`. Add `Microsoft-Windows-Sysmon/Operational`, `Microsoft-Windows-PowerShell/Operational`, and `Microsoft-Windows-Windows Defender/Operational` to use the corresponding rule files. The stock agent filters Security with an XPath query that drops noisy IDs (5145, 5156, 5447, 4656, 4658, 4663, 4660, 4670, 4690, 4703, 4907, 5152, 5157); copying that keeps volume down.

Use `EvtSubscribe` with a bookmark persisted to disk so events are not lost or replayed across restarts.

---

## 7. The file-change events (`{"path":…,"type":"modification"}`)

Two options.

**Option A: keep the custom JSON, add rules on the manager.** Simplest. Send on queue `1` with a stable, distinctive location, and add a discriminator field so rules do not collide with other JSON sources:

```
1:custom-agent-fim:{"source":"cusa_fim","path":"C:\\Users\\x\\file.txt","type":"modification"}
```

`/var/ossec/etc/rules/custom_agent_fim_rules.xml` (pick IDs in the 100000–120000 range that are free on this manager):

```xml
<group name="custom_agent,fim,">
  <rule id="110500" level="0">
    <decoded_as>json</decoded_as>
    <field name="source">^cusa_fim$</field>
    <description>Custom agent FIM event.</description>
  </rule>
  <rule id="110501" level="5">
    <if_sid>110500</if_sid>
    <field name="type">^modification$</field>
    <description>Custom agent: file modified: $(path)</description>
  </rule>
</group>
```

Then restart the manager. The generic JSON decoder caps at 256 fields per event (`analysisd.decoder_order_size=256`); `ossec.log` already has many `Too many fields for JSON decoder` errors from another source, so keep events flat and small.

The agent is also reporting changes to its own state file (`.cusa\state\state.json`), 600 times in a few minutes. Exclude the agent's own working directory.

**Option B: speak the native syscheck protocol** (queue `8`, location `syscheck`) to get stock FIM rules (550, 553, 554) and the FIM dashboard. This also requires implementing the syscheck DB-sync messages on queue `5`, which is considerably more work. Capture a stock agent (section 9) for the exact JSON before attempting it. **[source]**

---

## 8. Checklist for the agent developer

1. Keepalive: multi-line format from section 3.3 with Windows-style OS string, `merged.mg` line, and trailing newlines.
2. Enroll with `G:'default'`, or have the manager admin assign a group.
3. Windows events: queue `f`, location `EventChannel`, JSON with `Event` (raw XML from `EvtRender`) and `Message` (from `EvtFormatMessage`).
4. Do not transform the XML: no field renaming, no flattening, keep `Level`, `Keywords`, `Channel`, `Provider`.
5. Serialize with a real JSON encoder; one event per message; under 65,536 bytes.
6. Persist message counters and event log bookmarks across restarts.
7. Handle `#!-up file` / `#!-close file` and report the resulting `merged.mg` MD5.
8. Exclude the agent's own files from file monitoring.

---

## 9. Verifying on the manager

Run these on the manager while the agent is sending.

**Is the agent healthy?** OS and version should no longer be `(null)`:

```bash
/var/ossec/bin/agent_control -i 019
```

**Any protocol or decode errors?**

```bash
grep -E "T-LT-0107|\(019\)|'019'" /var/ossec/logs/ossec.log | tail -20
grep "winevtchannel.c" /var/ossec/logs/ossec.log | tail -20
```

The `winevtchannel.c` lines are DEBUG level. They are visible now, but the config files show `analysisd.debug=0`, so debug was probably enabled at runtime. To make it persistent, add `analysisd.debug=2` and `remoted.debug=2` to `/var/ossec/etc/local_internal_options.conf` and restart.

**Did events arrive, and how were they decoded?** Target: `windows_eventchannel` / `EventChannel`:

```bash
grep '"name":"T-LT-0107"' /var/ossec/logs/archives/archives.json | tail -200 \
  | grep -o '"decoder":{[^}]*}\|"location":"[^"]*"' | sort | uniq -c
```

**Did rules fire?**

```bash
grep '"name":"T-LT-0107"' /var/ossec/logs/alerts/alerts.json | tail -5
```

**Reference capture from a stock agent.** The fastest way to settle any byte-level question is to diff against a working agent. On a Windows machine with the stock 4.11.2 agent, add to `C:\Program Files (x86)\ossec-agent\local_internal_options.conf`:

```
agent.debug=2
windows.debug=2
```

Restart the service and read `ossec.log` in the same folder: it prints the keepalive and outgoing messages in clear text. On the manager side, the stock agent's decoded output is already in `archives.json` (`grep '"name":"T-LT-0368"'`).

**Quick end-to-end test.** On the endpoint, generate a failed logon (wrong password via `runas /user:nosuchuser cmd`). Expected on the manager: an archive entry with `eventID 4625`, `severityValue AUDIT_FAILURE`, and an alert from rule **60122** "Logon Failure - Unknown user or bad password". This requires "Audit Logon: Failure" to be enabled in the endpoint's audit policy.
