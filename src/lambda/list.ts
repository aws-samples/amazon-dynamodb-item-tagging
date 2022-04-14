/*!
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
*/
import { DocumentClient } from 'aws-sdk/clients/dynamodb';

import { DynamoDbUtils } from '../utils/dynamoDb.util';
import {
    Tags, TaskItem, TaskItemIdListPaginationKey, TaskItemListPaginationKey
} from './models';

/**
 * The lambda handler function to list existing task items, optionally filtering by tags
 */
export class ListService {

    private readonly MAX_LIST_RESULTS = 20;
    private readonly dynamoDbUtils: DynamoDbUtils;

    public constructor (
        private dc: DocumentClient,
        private tableName: string
    ) {
        this.dynamoDbUtils = new DynamoDbUtils(dc);
    }

    public async process(tags?: Tags, paginationKey?: TaskItemListPaginationKey, count?: number): Promise<[TaskItem[], TaskItemListPaginationKey]> {

        let results: [TaskItem[], TaskItemListPaginationKey] = [undefined, undefined];

        // if tags have been provided as a filter then we need to search filtering by tags first, but if not then we can just retrieve the task items
        if (Object.keys(tags??{}).length > 0) {
            // first retrieve the list of task ids that match all the tags
            const [taskIds, nextToken] = await this.listIds(tags, paginationKey, count);
            if ((taskIds?.length ?? 0) > 0) {
                // next retrieve the actual task items
                const items = await this.getItemsFromDb(taskIds);
                results = [items, nextToken];
            }
        } else {
            results = await this.listItemsFromDb(paginationKey, count);
        }

        return results;
    }

    private async listIds(tags: Tags, paginationKey?: TaskItemListPaginationKey, count = this.MAX_LIST_RESULTS): Promise<[string[], TaskItemListPaginationKey]> {

        if (count) {
            count = Number(count);
        }

        // convert tags map to arrays to make referencing them later easier
        const tagKeys = Object.keys(tags);
        const tagValues = Object.values(tags);
        const tagCount = tagKeys.length;

        // retrieve the first page of results for each tag
        const resultsForTagsFutures: Promise<[string[], TaskItemListPaginationKey]>[] = new Array(tagCount);
        for (let tagIndex = 0; tagIndex < tagCount; tagIndex++) {
            const tagPaginationKey: TaskItemIdListPaginationKey = {
                id: paginationKey?.id,
                tagName: tagKeys[tagIndex],
                tagValue: tagValues[tagIndex],
            };
            resultsForTagsFutures[tagIndex] = this.listIdsFromDbUsingTags(tagKeys[tagIndex], tagValues[tagIndex], tagPaginationKey, count);
        }
        const resultsForTags = await Promise.all(resultsForTagsFutures);
        const idsForTags = resultsForTags.map(([ids, _paginationKey]) => ids);

        // if any of the initial results are empty, then we can exit immediately as there are no common matches across all requested tags
        for (let tagIndex = 0; tagIndex < tagCount; tagIndex++) {
            if ((idsForTags[tagIndex]?.length ?? 0) === 0) {
                return [undefined, undefined];
            }
        }

        // this inline function will populate new pages of TaskItem ids for a specific tag
        const getNextPageOfResults = async (tagIndex: number): Promise<boolean> => {
            const paginationKey = resultsForTags[tagIndex]?.[1];
            if (paginationKey === undefined) {
                // no more to process
                return false;
            }
            resultsForTags[tagIndex] = await this.listIdsFromDbUsingTags(tagKeys[tagIndex], tagValues[tagIndex], paginationKey, count);
            if ((resultsForTags[tagIndex]?.[0]?.length ?? 0) === 0) {
                // no more to process
                return false;
            } else {
                // store the new page of tags, and reset its pointer
                idsForTags[tagIndex] = resultsForTags[tagIndex]?.[0];
                listPointers[tagIndex] = 0;
                return true;
            }
        }

        // this inline function will retrieve the next item id for a specific tag from the returned results
        const getNextItemIdFromResults = async (tagIndex: number): Promise<string> => {
            let tagTaskItemId = idsForTags[tagIndex][listPointers[tagIndex]];
            if (tagTaskItemId === undefined) {
                const hasMoreResults = await getNextPageOfResults(tagIndex);
                if (hasMoreResults) {
                    tagTaskItemId = idsForTags[tagIndex][listPointers[tagIndex]];
                }
            }
            return tagTaskItemId;
        }

        // process each list of TaskItemIds per tag, saving where the TaskItemId is found across all tags        
        const matchedItemIds: string[] = [];
        const listPointers = new Array(tagCount).fill(0);
        const lastTagIndex = tagCount - 1;
        let keepGoing = true;
        while (keepGoing && matchedItemIds.length < count) {
            for (let tagIndex = 0; tagIndex < tagCount; tagIndex++) {
                const currentTagTaskItemId = await getNextItemIdFromResults(tagIndex)
                if (currentTagTaskItemId === undefined) {
                    // no more results, so we can stop searching
                    keepGoing = false;
                    break;
                }
                // if we reached the last tag index, it means we found a match across all tags
                if (tagIndex === lastTagIndex) {
                    // add the matched id to the result
                    matchedItemIds.push(currentTagTaskItemId);
                    // increment all the pointers to reference the next result for each tag
                    listPointers.forEach((_value, index) => listPointers[index]++);
                } else {
                    // check for matching TaskItemIds between this and the next tag to be compared
                    const nextTagIndex = tagIndex + 1;
                    const nextTagTaskItemId = await getNextItemIdFromResults(nextTagIndex)
                    if (nextTagTaskItemId === undefined) {
                        // no more results, so we can stop searching
                        keepGoing = false;
                        break;
                    }

                    if (currentTagTaskItemId === nextTagTaskItemId) {
                        // we have a match across the tag pair being checked, so lets move onto checking the next tag pair
                        continue;
                    } else if (currentTagTaskItemId < nextTagTaskItemId) {
                        // this tag has a lower TaskItem id, therefore increment this tags index, then restart the matching
                        listPointers[tagIndex]++;
                        break;
                    } else {
                        // the next tag has a lower TaskItem id, therefore increment the next tags index, then restart the matching
                        listPointers[nextTagIndex]++;
                        break;
                    }
                }
            }
        }

        let nextToken: TaskItemListPaginationKey;
        if (matchedItemIds.length === count) {
            nextToken = {
                id: matchedItemIds[count - 1],
            }
        }

        const result: [string[], TaskItemListPaginationKey] = [matchedItemIds, nextToken];
        return result;

    }

    private async listIdsFromDbUsingTags(tagName: string, tagValue: string, exclusiveStart?: TaskItemIdListPaginationKey, count?: number): Promise<[string[], TaskItemIdListPaginationKey]> {

        let exclusiveStartKey: DocumentClient.Key;
        if (exclusiveStart?.id) {
            exclusiveStartKey = {
                pk: `tag#${exclusiveStart.tagName}`,
                sk: `${exclusiveStart.tagValue}#task#${exclusiveStart.id}`,
            }
        }

        const params: DocumentClient.QueryInput = {
            TableName: this.tableName,
            KeyConditionExpression: `#hash = :hash AND begins_with(#sort,:sort)`,
            ExpressionAttributeNames: {
                '#hash': 'pk',
                '#sort': 'sk',
            },
            ExpressionAttributeValues: {
                ':hash': `tag#${tagName}`,
                ':sort': `${tagValue}#task#`,
            },
            ExclusiveStartKey: exclusiveStartKey,
            Limit: count ?? this.MAX_LIST_RESULTS,
        };

        const results = await this.dc.query(params).promise();
        if ((results?.Count ?? 0) === 0) {
            return [undefined, undefined];
        }

        const taskIds: string[] = [];
        for (const i of results.Items) {
            taskIds.push(i.sk.split('#')[2]);
        }

        let paginationKey: TaskItemIdListPaginationKey;
        if (results.LastEvaluatedKey) {
            paginationKey = {
                tagName: results.LastEvaluatedKey.pk.split('#')[1],
                tagValue: results.LastEvaluatedKey.sk.split('#')[0],
                id: results.LastEvaluatedKey.sk.split('#')[2],
            }
        }
        const response: [string[], TaskItemIdListPaginationKey] = [taskIds, paginationKey];
        return response;
    }

    private async getItemsFromDb(taskIds: string[]): Promise<TaskItem[]> {

        const params: DocumentClient.BatchGetItemInput = {
            RequestItems: {}
        };
        params.RequestItems[this.tableName] = {
            Keys: taskIds.map(id => ({
                pk: `task#${id}`,
                sk: `task#${id}`,
            }))
        };

        const response = await this.dynamoDbUtils.batchGetAll(params);
        if (response?.Responses?.[this.tableName] == undefined) {
            return [];
        }
        const items = this.assembleItems(response.Responses[this.tableName]);

        return items;
    }

    private async listItemsFromDb(exclusiveStart?: TaskItemListPaginationKey, count?: number): Promise<[TaskItem[], TaskItemListPaginationKey]> {

        let exclusiveStartKey: DocumentClient.Key;
        if (exclusiveStart?.id) {
            const lasttaskId = `task#${exclusiveStart.id}`;
            exclusiveStartKey = {
                pk: lasttaskId,
                sk: lasttaskId,
                siKey1: 'task',
            }
        }

        const params: DocumentClient.QueryInput = {
            TableName: this.tableName,
            IndexName: 'siKey1-sk-index',
            KeyConditionExpression: `#hash = :hash`,
            ExpressionAttributeNames: {
                '#hash': 'siKey1'
            },
            ExpressionAttributeValues: {
                ':hash': 'task'
            },
            Select: 'ALL_ATTRIBUTES',
            ExclusiveStartKey: exclusiveStartKey,
            Limit: count ?? this.MAX_LIST_RESULTS
        };

        const results = await this.dc.query(params).promise();
        if ((results?.Count ?? 0) === 0) {
            return [undefined, undefined];
        }

        const items = this.assembleItems(results.Items);

        let paginationKey: TaskItemListPaginationKey;
        if (results.LastEvaluatedKey) {
            const lastEvaluatedtaskId = results.LastEvaluatedKey.pk.split('#')[1];
            paginationKey = {
                id: lastEvaluatedtaskId,
            }
        }
        const response: [TaskItem[], TaskItemListPaginationKey] = [items, paginationKey];
        return response;
    }

    private assembleItems(items: DocumentClient.ItemList): TaskItem[] {
        const list: TaskItem[] = [];
        for (const attrs of items) {
            const r: TaskItem = {
                id: attrs.pk.split('#')[1],
                name: attrs.name,
                description: attrs.description,
                tags: attrs.tags,
            };
            list.push(r);
        }
        return list;
    }
}
