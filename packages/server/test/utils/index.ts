import {Client} from '@modelcontextprotocol/sdk/client';
import {CallToolRequest} from '@modelcontextprotocol/sdk/types.js';

export function callToolWithTextResponse(
	client: Client,
	params: CallToolRequest['params'],
) {
	return client.callTool(params) as Promise<{
		content: {type: 'text'; text: string}[];
		isError: boolean;
	}>;
}
