[**AgentScript API**](../index.md) • **Docs**

***

# Function: parseAgentScript()

> **parseAgentScript**(`code`): `Promise`\<[`SerializedNode`](../interfaces/SerializedNode.md) \| `null`\>

Parse AgentScript source code

## Parameters

• **code**: `string`

The AgentScript source code to parse

## Returns

`Promise`\<[`SerializedNode`](../interfaces/SerializedNode.md) \| `null`\>

The serialized parse tree root node, or null if parsing fails

## Defined in

[monaco/src/parser-api.ts:91](https://github.com/salesforce/agentscript/blob/345a16d645d544732e614c1fca12c4a165c02ab0/packages/monaco/src/parser-api.ts#L91)
