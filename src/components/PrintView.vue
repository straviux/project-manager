<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  Play,
  Printer,
  RefreshCw,
  Square,
  X,
} from "@lucide/vue";
import { open } from "@tauri-apps/plugin-dialog";
import {
  openUrl,
  printCheckPrerequisites,
  printDefaultServerDir,
  printServerStatus,
  printStartServer,
  printStopServer,
} from "../lib/api";
import { getSetting, setSetting } from "../lib/db";
import { pickerDefaultPath } from "../lib/paths";
import { showToast } from "../lib/toast";
import type { PrintPrerequisites, PrintServerStatus } from "../types";

/**
 * Printing tab (Level 1 print-server setup panel): this app is the
 * host/client setup, not the server itself. The Python print server
 * in the print-server folder still does the real work (queue, Office
 * conversion, printing); this tab only checks the host is ready and
 * starts/stops it, so users never type the cmd steps by hand.
 * Uploading and the queue stay in the browser print page, opened
 * from here — the app's CSP only allows connections to itself, so
 * this tab cannot fetch the print server directly.
 *
 * Host: pick the print-server folder once, run the checks, pick the
 * printer and port, Start. The server keeps running until Stop is
 * pressed here — closing the app does NOT stop it.
 * Client: save another PC's host address and open its print page.
 */
const props = defineProps<{ active: boolean }>();

const SERVER_DIR_KEY = "print_server_dir";
const CLIENT_HOST_KEY = "print_client_host";
const PRINT_PORT_KEY = "print_port";
const PRINT_PRINTER_KEY = "print_printer";

const serverDir = ref("");
const port = ref(8000);
const printer = ref("");
const checks = ref<PrintPrerequisites | null>(null);
const checking = ref(false);
const starting = ref(false);
const stopping = ref(false);
const status = ref<PrintServerStatus | null>(null);
const error = ref<string | null>(null);
const clientHost = ref("");

async function loadSettings() {
  serverDir.value = (await getSetting(SERVER_DIR_KEY)) ?? "";
  if (!serverDir.value) {
    // First use: the print-server files ship in the repo's
    // print-server/ folder, so auto-detect usually finds them.
    try {
      const found = await printDefaultServerDir();
      if (found) {
        serverDir.value = found;
        await setSetting(SERVER_DIR_KEY, found);
      }
    } catch {
      // No auto-detect — the user picks the folder by hand.
    }
  }
  clientHost.value = (await getSetting(CLIENT_HOST_KEY)) ?? "";
  const savedPort = Number(await getSetting(PRINT_PORT_KEY));
  if (savedPort > 0 && savedPort <= 65535) port.value = savedPort;
  printer.value = (await getSetting(PRINT_PRINTER_KEY)) ?? "";
}

async function refreshStatus() {
  try {
    status.value = await printServerStatus();
  } catch {
    status.value = null;
  }
}

async function runChecks() {
  if (!serverDir.value) {
    error.value = "Choose the print-server folder first — the folder with server.py in it.";
    return;
  }
  checking.value = true;
  error.value = null;
  try {
    checks.value = await printCheckPrerequisites(serverDir.value);
    if (checks.value.printers.length && !printer.value) {
      printer.value =
        checks.value.printers.find((p) => p.toLowerCase().includes("l3210")) ??
        checks.value.printers[0];
      await setSetting(PRINT_PRINTER_KEY, printer.value);
    }
  } catch (e) {
    error.value = String(e);
  } finally {
    checking.value = false;
  }
}

async function chooseServerDir() {
  const picked = await open({
    directory: true,
    multiple: false,
    defaultPath: await pickerDefaultPath(),
  });
  if (typeof picked === "string" && picked) {
    serverDir.value = picked;
    await setSetting(SERVER_DIR_KEY, picked);
    checks.value = null;
    await runChecks();
  }
}

async function startServer() {
  if (!checks.value) await runChecks();
  if (checks.value && !checks.value.serverFound) {
    error.value = "server.py was not found in that folder. Choose the print-server folder first.";
    return;
  }
  if (checks.value && !checks.value.pythonOk) {
    error.value = "Python was not found. Install Python 3.9 or newer first — see the check above.";
    return;
  }
  starting.value = true;
  error.value = null;
  try {
    const url = await printStartServer(serverDir.value, port.value, printer.value);
    await refreshStatus();
    showToast(`Print server started at ${url}`);
  } catch (e) {
    error.value = String(e);
  } finally {
    starting.value = false;
  }
}

async function stopServer() {
  stopping.value = true;
  error.value = null;
  try {
    await printStopServer();
    await refreshStatus();
    showToast("Print server stopped.");
  } catch (e) {
    error.value = String(e);
  } finally {
    stopping.value = false;
  }
}

async function openPrintPage(url: string) {
  const clean = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(clean)) {
    error.value = "That address needs to start with http:// — for example http://192.168.1.42:8000";
    return;
  }
  try {
    await openUrl(clean);
  } catch (e) {
    error.value = String(e);
  }
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} copied.`);
  } catch {
    error.value = "Could not copy — select the address and copy it by hand.";
  }
}

async function saveClientHost() {
  await setSetting(CLIENT_HOST_KEY, clientHost.value.trim());
}

async function savePort() {
  await setSetting(PRINT_PORT_KEY, String(port.value));
}

async function savePrinter() {
  await setSetting(PRINT_PRINTER_KEY, printer.value);
}

function checkRow(ok: boolean, label: string, detail: string) {
  return { ok, label, detail };
}

onMounted(async () => {
  await loadSettings();
  await refreshStatus();
  if (serverDir.value && !checks.value) await runChecks();
});

watch(
  () => props.active,
  (isActive) => {
    if (isActive) void refreshStatus();
  },
);
</script>

<template>
  <div>
    <div class="mb-4">
      <h1 class="flex items-center gap-2 text-lg font-semibold">
        <Printer class="h-5 w-5" /> Printing
      </h1>
      <p class="text-sm text-neutral-500">
        Share the office USB printer (Epson L3210) with the rest of the
        network. This tab sets the server up and starts it — uploading
        and the print queue still happen in the browser print page.
      </p>
    </div>

    <div v-if="error" class="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {{ error }}
    </div>

    <!-- Host: this PC shares its USB printer -->
    <section class="mb-6 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 class="mb-1 text-sm font-semibold">Host — share this PC's printer</h2>
      <p class="mb-3 text-sm text-neutral-500">
        Plug the L3210 into this PC by USB, then start the server here.
        Other PCs print by opening the host address in a browser.
      </p>

      <label class="mb-1 block text-xs font-semibold">Print-server folder</label>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <span class="min-w-0 flex-1 truncate font-mono text-sm" :title="serverDir">
          {{ serverDir || "Not chosen yet" }}
        </span>
        <button class="toolbar-btn" @click="chooseServerDir">
          <FolderOpen class="h-4 w-4" /> Choose folder
        </button>
      </div>

      <button class="toolbar-btn mb-3" :disabled="checking || !serverDir" @click="runChecks">
        <RefreshCw class="h-4 w-4" /> {{ checking ? "Checking…" : "Check this PC is ready" }}
      </button>

      <ul v-if="checks" class="mb-3 space-y-2 text-sm">
        <li
          v-for="row in [
            checkRow(checks.serverFound, 'Print-server folder', checks.serverFound ? 'server.py found.' : 'server.py was not found in that folder.'),
            checkRow(checks.pythonOk, 'Python', checks.pythonDetail),
            checkRow(checks.sumatraOk, 'SumatraPDF', checks.sumatraDetail),
            checkRow(checks.printers.length > 0, 'Printers', checks.printers.length ? checks.printers.join(', ') : (checks.printersError || 'No printers found. Is the Epson driver installed?')),
            checkRow(checks.l3210Found, 'Epson L3210', checks.l3210Found ? 'L3210 detected.' : 'No printer named L3210 was found — check the USB cable and driver.'),
            checkRow(checks.officeOk, 'Office files', checks.officeDetail),
          ]"
          :key="row.label"
          class="flex items-start gap-2"
        >
          <Check v-if="row.ok" class="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          <X v-else class="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <span>
            <strong>{{ row.label }}:</strong> {{ row.detail }}
          </span>
        </li>
      </ul>

      <div class="mb-3 flex flex-wrap items-end gap-3">
        <label class="block">
          <span class="mb-1 block text-xs font-semibold">Printer</span>
          <select
            v-model="printer"
            class="on-bg rounded-lg border border-neutral-300 bg-transparent px-2 py-2 text-sm outline-none dark:border-neutral-700"
            @change="savePrinter"
          >
            <option value="">System default</option>
            <option v-for="p in checks?.printers ?? []" :key="p" :value="p">{{ p }}</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-xs font-semibold">Port</span>
          <input
            v-model.number="port"
            type="number"
            min="1"
            max="65535"
            class="on-bg w-24 rounded-lg border border-neutral-300 bg-transparent px-2 py-2 text-sm outline-none dark:border-neutral-700"
            @change="savePort"
          />
        </label>
        <button
          v-if="!status?.running"
          class="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          :disabled="starting || !serverDir"
          @click="startServer"
        >
          <Play class="mr-1 inline h-4 w-4" /> {{ starting ? "Starting…" : "Start print server" }}
        </button>
        <button
          v-else
          class="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          :disabled="stopping"
          @click="stopServer"
        >
          <Square class="mr-1 inline h-4 w-4" /> {{ stopping ? "Stopping…" : "Stop print server" }}
        </button>
      </div>

      <div v-if="status?.running" class="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
        <p class="mb-1"><strong>Running at {{ status.url }}</strong> — give this address to the other PCs.</p>
        <p class="mb-2 text-xs">Keep this PC on and awake while people print. Closing this app does not stop the server — use Stop here.</p>
        <div class="flex flex-wrap gap-2">
          <button class="toolbar-btn" @click="openPrintPage(status.url)">
            <ExternalLink class="h-4 w-4" /> Open print page
          </button>
          <button class="toolbar-btn" @click="copyText(status.url, 'Host address')">
            <Copy class="h-4 w-4" /> Copy address
          </button>
        </div>
      </div>
      <p v-else class="text-sm text-neutral-500">
        The server is not running from this app. If it was started another way, Stop here will not stop it — close that server window instead.
      </p>
    </section>

    <!-- Client: print to another PC's server -->
    <section class="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 class="mb-1 text-sm font-semibold">Client — print to another PC's server</h2>
      <p class="mb-3 text-sm text-neutral-500">
        Save the host PC's address once, then open its print page in your
        browser to upload a file. You do not need the printer plugged in
        here, and you do not need its driver.
      </p>
      <label class="mb-1 block text-xs font-semibold">Host address</label>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="clientHost"
          type="text"
          placeholder="http://192.168.1.42:8000"
          class="on-bg min-w-52 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
          @change="saveClientHost"
        />
        <button class="toolbar-btn" :disabled="!clientHost.trim()" @click="openPrintPage(clientHost)">
          <ExternalLink class="h-4 w-4" /> Open print page
        </button>
        <button class="toolbar-btn" :disabled="!clientHost.trim()" @click="copyText(clientHost.trim(), 'Host address')">
          <Copy class="h-4 w-4" /> Copy
        </button>
      </div>
    </section>
  </div>
</template>
