import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FnAdapter,
  HttpAdapter,
  ToolRegistry,
  type McpAdapter,
} from '@agentscript/runtime';
import type {
  AgentDSLAuthoring,
  AgentDSLAuthoringWithDeployment,
  LlmConfig,
  McpServerConfig,
} from '@agentscript/compiler';
import {
  compileSource,
  createAgent,
  type AgentScriptAgent,
  type VercelDriverOptions,
} from '@agentscript/runtime-vercel';
import {
  createLlmOptionsFromDeployment,
  createLlmOptionsFromServerConfig,
  reconcileDeploymentLlm,
} from './llm-factory.js';
import { createMcpAdapter, reconcileDeploymentMcp } from './mcp-factory.js';
import type { ServerConfig } from './types.js';

interface AgentDocEntry {
  id: string;
  doc: AgentDSLAuthoring;
}

export class AgentRegistry {
  private readonly docs = new Map<string, AgentDSLAuthoring>();
  private readonly tools: ToolRegistry;

  private constructor(
    entries: AgentDocEntry[],
    private readonly llm: VercelDriverOptions,
    tools: ToolRegistry
  ) {
    for (const entry of entries) {
      this.docs.set(entry.id, entry.doc);
    }
    this.tools = tools;
  }

  static async load(
    config: ServerConfig,
    llm?: VercelDriverOptions
  ): Promise<AgentRegistry> {
    const files = await collectAgentFiles(config.agentsDir);
    if (files.length === 0) {
      throw new Error(`No .agent files found in ${config.agentsDir}`);
    }

    const entries: AgentDocEntry[] = [];
    const llmDeclarations: Array<{ id: string; llm?: LlmConfig }> = [];
    const mcpDeclarations: Array<{
      id: string;
      mcp?: Record<string, McpServerConfig>;
    }> = [];
    for (const filePath of files) {
      const source = await readFile(filePath, 'utf8');
      const result = compileSource(source);
      const hardErrors = result.diagnostics.filter(
        diagnostic =>
          diagnostic.severity === 1 &&
          diagnostic.code !== 'invalid-action-target'
      );
      if (hardErrors.length > 0) {
        const messages = hardErrors.map(error => error.message).join('; ');
        throw new Error(`Failed to compile ${filePath}: ${messages}`);
      }
      const fileName = path.basename(filePath, '.agent');
      entries.push({ id: fileName, doc: result.output });
      const deployment = (result.output as AgentDSLAuthoringWithDeployment)
        .deployment;
      llmDeclarations.push({ id: fileName, llm: deployment?.llm });
      mcpDeclarations.push({ id: fileName, mcp: deployment?.mcp });
    }

    const declaredLlm = reconcileDeploymentLlm(llmDeclarations);
    const effectiveLlm =
      llm ??
      (declaredLlm
        ? createLlmOptionsFromDeployment(declaredLlm)
        : createLlmOptionsFromServerConfig(config));

    const declaredMcp = reconcileDeploymentMcp(mcpDeclarations);
    const mcpAdapter = declaredMcp ? createMcpAdapter(declaredMcp) : undefined;

    return new AgentRegistry(
      entries,
      effectiveLlm,
      createToolRegistry(config, mcpAdapter)
    );
  }

  listAgents(): string[] {
    return [...this.docs.keys()].sort();
  }

  hasAgent(agentId: string): boolean {
    return this.docs.has(agentId);
  }

  createAgent(
    agentId: string,
    context?: Record<string, unknown>
  ): AgentScriptAgent {
    const doc = this.docs.get(agentId);
    if (!doc) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    return createAgent({
      doc,
      llm: this.llm,
      tools: this.tools,
      context,
    });
  }
}

async function collectAgentFiles(rootDir: string): Promise<string[]> {
  const result: string[] = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith('.agent')) {
        result.push(fullPath);
      }
    }
  }

  return result;
}

function createToolRegistry(
  config: ServerConfig,
  mcp?: McpAdapter
): ToolRegistry {
  const tools = new ToolRegistry();
  const fn = new FnAdapter();
  seedDefaultFnHandlers(fn);
  seedFlowMocks(fn);
  tools.register('fn', fn);

  const headers = config.toolHttpHeaders;
  const http = new HttpAdapter(headers ? { headers } : {});
  tools.register('http', http);
  tools.register('https', http);

  if (mcp) {
    tools.register('mcp', mcp);
  }

  return tools;
}

function seedDefaultFnHandlers(fn: FnAdapter): void {
  fn.register('echo', args => ({ result: args }));

  fn.register('lookup_order', args => {
    const { order_number } = args as { order_number?: string };
    return {
      status:
        order_number === 'ORD-42' || order_number === '42'
          ? 'shipped'
          : 'processing',
      order_id: String(order_number ?? 'unknown'),
    };
  });

  fn.register('verify_customer', args => {
    const { email } = args as { email?: string };
    return {
      verified: Boolean(email && email.includes('@')),
      customer_name: email ? email.split('@')[0] : 'guest',
    };
  });

  fn.register('get_hotel_price', args => {
    const { destination } = args as { destination?: string };
    const normalized = String(destination ?? '')
      .trim()
      .toLowerCase();
    if (normalized.includes('san francisco')) {
      return {
        destination: 'San Francisco',
        hotel_price_usd: 300,
      };
    }
    if (normalized.includes('london')) {
      return {
        destination: 'London',
        hotel_price_usd: 200,
      };
    }
    return {
      destination: destination ?? 'Unknown',
      hotel_price_usd: null,
      note: 'Hotel pricing is available for London and San Francisco only.',
    };
  });

  fn.register('get_plane_price', args => {
    const { destination } = args as { destination?: string };
    const normalized = String(destination ?? '')
      .trim()
      .toLowerCase();
    if (normalized.includes('san francisco')) {
      return {
        destination: 'San Francisco',
        plane_price_usd: 1200,
      };
    }
    if (normalized.includes('london')) {
      return {
        destination: 'London',
        plane_price_usd: 400,
      };
    }
    return {
      destination: destination ?? 'Unknown',
      plane_price_usd: null,
      note: 'Flight pricing is available for London and San Francisco only.',
    };
  });
}

/**
 * Mock handlers for the order-tracking demo agent. These simulate flow://
 * actions used by the Order_Tracking_Assistant_v1 sample so the agent can
 * be exercised end-to-end without a real backend.
 */
function logFlowCall(name: string, args: unknown, result: unknown): void {
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'flow_call',
      name,
      args,
      result,
    })
  );
}

function seedFlowMocks(flow: FnAdapter): void {
  flow.register('GetCustomerInfo', args => {
    const { email } = args as { email?: string };
    const found = Boolean(email && email.includes('@'));
    const result = {
      customer_found: found,
      customer_name: found ? (email!.split('@')[0] ?? 'Customer') : '',
      customer_id: found ? `CUST-${hashString(email!)}` : '',
      verified: found,
    };
    logFlowCall('GetCustomerInfo', args, result);
    return result;
  });

  flow.register('FindOrderByNumber', args => {
    const { order_number, customer_id } = args as {
      order_number?: string;
      customer_id?: string;
    };
    const found = Boolean(order_number);
    const result = {
      order_found: found,
      order_data: found
        ? { order_number, customer_id: customer_id ?? null }
        : null,
      valid_customer: Boolean(customer_id),
    };
    logFlowCall('FindOrderByNumber', args, result);
    return result;
  });

  flow.register('GetOrderDetails', args => {
    const { order_number } = args as { order_number?: string };
    const result = {
      order_status: 'In Transit',
      tracking_number: `TRK-${hashString(order_number ?? 'x')}`,
      delivery_date: '2026-06-05',
      order_total: 149.99,
      shipping_address: '123 Demo Street, San Francisco, CA 94105',
      return_eligible: true,
    };
    logFlowCall('GetOrderDetails', args, result);
    return result;
  });

  flow.register('GetTrackingUpdates', args => {
    const { tracking_number } = args as { tracking_number?: string };
    const result = {
      current_status: 'Out for delivery',
      location: 'San Francisco distribution center',
      updated_delivery_date: '2026-06-04',
      delivery_attempts: 1,
      tracking_number: tracking_number ?? null,
    };
    logFlowCall('GetTrackingUpdates', args, result);
    return result;
  });

  flow.register('ProcessReturnRequest', args => {
    const { order_number } = args as { order_number?: string };
    const result = {
      return_authorized: true,
      return_label_url: `https://example.com/return-labels/${encodeURIComponent(order_number ?? 'unknown')}.pdf`,
      refund_amount: 149.99,
      return_deadline: '2026-06-30',
    };
    logFlowCall('ProcessReturnRequest', args, result);
    return result;
  });

  flow.register('ReportShippingIssue', args => {
    const { tracking_number } = args as { tracking_number?: string };
    const result = {
      case_number: `CASE-${hashString(tracking_number ?? 'x')}`,
      resolution_timeframe: '2 business days',
      escalated: false,
    };
    logFlowCall('ReportShippingIssue', args, result);
    return result;
  });
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 6).toUpperCase();
}
