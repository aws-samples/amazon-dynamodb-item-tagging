import { APIGatewayEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DocumentClient } from 'aws-sdk/clients/dynamodb';

import { ListService } from './list';
import { Tags, TaskItemListPaginationKey, TaskListItem } from './models';

const dc = new DocumentClient();
const tableName = process.env.TABLE_NAME as string;
const service = new ListService(dc, tableName);

/**
 * The lambda handler function to list existing task items, optionally filtering by tags
 */
exports.handler = async (event: APIGatewayEvent, _context: Context): Promise<APIGatewayProxyResult> => {

    try {

        // retrieve the provided query string values and convert them to something we can use more easily
        const tagsQS = event.multiValueQueryStringParameters?.tag as string | string[];
        const tags = convertTagsQS(tagsQS);
        const paginationKeyQS = event.queryStringParameters?.paginationKey;
        const paginationKey: TaskItemListPaginationKey = (paginationKeyQS) ? { id: paginationKeyQS } : undefined;
        const countQS = event.queryStringParameters?.count as string;
        const count = (countQS) ? parseInt(countQS) : undefined;

        // perform the search
        const results = await service.process(tags, paginationKey, count);

        // assemble and return the response
        const response: TaskListItem = {
            items: results[0]
        };

        if (paginationKey?.id || count) {
            response['pagination'] = {};
        }
        if (paginationKey?.id) {
            response['pagination']['nextToken'] = paginationKey?.id;
        }
        if (count) {
            response['pagination']['count'] = count;
        }

        return {
            statusCode: 200,
            body: JSON.stringify(response),
        };

    } catch (e) {
        return handleError(e);
    }
}

/**
 * Converts the tag multi-valued query string parameter into a map of tag names to tag values
 * @param tagsQS 
 * @returns 
 */
function convertTagsQS(tagsQS: string | string[]): Tags {
    const tags: Tags = {};
    if (typeof tagsQS === 'string') {
        tagsQS = [tagsQS];
    }
    if ((tagsQS?.length ?? 0) > 0) {
        tagsQS.forEach(t => {
            const [key, value] = t.split(':');
            tags[decodeURIComponent(key)] = decodeURIComponent(value);
        });
    }
    return tags;
}

function handleError(e: Error): APIGatewayProxyResult {
    if (e.name === 'ArgumentError') {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: e.message }),
        };
    } else {
        return {
            statusCode: 500,
            body: JSON.stringify({ message: e.message || e.name }),
        };
    }
}