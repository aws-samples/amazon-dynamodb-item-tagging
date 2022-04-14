/*!
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
*/

import { DocumentClient } from 'aws-sdk/clients/dynamodb';

export class DynamoDbUtils {

    private readonly MAX_RETRIES=3;
    private readonly DEFAULT_MAX_WRITE_BATCH_SIZE=25;
    private readonly DEFAULT_MAX_GET_BATCH_SIZE=100;

    public constructor(private dc: DocumentClient) {
    }

    public hasUnprocessedItems(result:DocumentClient.BatchWriteItemOutput):boolean {
        const has = result!==undefined && result.UnprocessedItems!==undefined;
        return has;
    }

    public async batchWriteAll(params:DocumentClient.BatchWriteItemInput, attempt=1) : Promise<DocumentClient.BatchWriteItemOutput> {

        if (attempt>this.MAX_RETRIES) {
            return params.RequestItems;
        }

        // dynamodb max batch size is 25 items, therefore split into smaller chunks if needed...
        const chunks = this.splitBatchWriteIntoChunks(params);

        // now process each chunk, including retries on failed intems...
        while(chunks.length) {
            const chunk = chunks.shift();
            const response = await this.dc.batchWrite(chunk).promise();
            if (response.UnprocessedItems!==undefined && Object.keys(response.UnprocessedItems).length>0) {
                const retryParams: DocumentClient.BatchWriteItemInput = {
                    RequestItems: response.UnprocessedItems
                };
                const retryResponse = await this.batchWriteAll(retryParams, attempt++);
                if (retryResponse.UnprocessedItems!==undefined && Object.keys(retryResponse.UnprocessedItems).length>0) {
                    // even after max retries we have failed items, therefore return all unprocessed items
                    return this.joinChunksIntoOutputBatchWrite(retryResponse, chunks);
                }
            }
        }

        return undefined;

    }

    public async batchGetAll(params:DocumentClient.BatchGetItemInput, attempt=1) : Promise<DocumentClient.BatchGetItemOutput> {

        if (attempt>this.MAX_RETRIES) {
            return params.RequestItems;
        }

        // dynamodb max read batch size is 100 items, therefore split into smaller chunks if needed...
        const chunks = this.splitBatchGetIntoChunks(params);
        let response:DocumentClient.BatchGetItemOutput = {Responses: {}};

        // now process each chunk, including retries on failed items...
        while(chunks.length) {
            const chunk = chunks.shift();
            const r = await this.dc.batchGet(chunk).promise();
            response = this.mergeBatchGetOutput(response, {Responses: r.Responses});
            if (r.UnprocessedKeys!==undefined && Object.keys(r.UnprocessedKeys).length>0) {
                const retryParams: DocumentClient.BatchGetItemInput = {
                    RequestItems: r.UnprocessedKeys
                };
                const retryResponse = await this.batchGetAll(retryParams, attempt++);
                response = this.mergeBatchGetOutput(response, {Responses: retryResponse.Responses});
            }
        }

        return response;
    }

    private splitBatchWriteIntoChunks(batch:DocumentClient.BatchWriteItemInput, maxBatchSize?:number) : DocumentClient.BatchWriteItemInput[] {

        if (maxBatchSize===undefined) {
            maxBatchSize=this.DEFAULT_MAX_WRITE_BATCH_SIZE;
        }

        // dynamodb max batch size is max 25 items, therefore split into smaller chunks if needed...
        let itemCount=0;
        Object.keys(batch.RequestItems).forEach(k=> itemCount+=batch.RequestItems[k].length);

        const chunks:DocumentClient.BatchWriteItemInput[]= [];
        if (itemCount>maxBatchSize) {
            let chunkSize=0;
            let chunk:DocumentClient.BatchWriteItemInput;
            Object.keys(batch.RequestItems).forEach(table=> {
                if (chunk===undefined) {
                    chunk=this.newBatchWriteItemInput(table);
                } else {
                    chunk.RequestItems[table]= [];
                }
                batch.RequestItems[table].forEach(item=> {
                    if (chunkSize>=maxBatchSize) {
                        // we've exceeded the max batch size, therefore save this and start with a new one
                        chunks.push(chunk);
                        chunk=this.newBatchWriteItemInput(table);
                        chunkSize=0;
                    }
                    // add it to the current chunk
                    chunk.RequestItems[table].push(item);
                    chunkSize++;
                });
            });
            chunks.push(chunk);

        } else {
            chunks.push(batch);
        }

        return chunks;
    }

    private splitBatchGetIntoChunks(batch:DocumentClient.BatchGetItemInput, maxBatchSize?:number) : DocumentClient.BatchGetItemInput[] {

        if (maxBatchSize===undefined) {
            maxBatchSize=this.DEFAULT_MAX_GET_BATCH_SIZE;
        }

        // dynamodb max get batch size is max 100 items, therefore split into smaller chunks if needed...
        let itemCount=0;
        Object.keys(batch.RequestItems).forEach(k=> itemCount+=batch.RequestItems[k].Keys.length);

        const chunks:DocumentClient.BatchGetItemInput[]= [];
        if (itemCount>maxBatchSize) {
            let chunkSize=0;
            let chunk:DocumentClient.BatchGetItemInput;
            Object.keys(batch.RequestItems).forEach(table=> {
                if (chunk===undefined) {
                    chunk=this.newBatchGetItemInput(table);
                } else {
                    chunk.RequestItems[table]= {Keys:[]};
                }
                batch.RequestItems[table].Keys.forEach(item=> {
                    if (chunkSize>=maxBatchSize) {
                        // we've exceeded the max batch size, therefore save this and start with a new one
                        chunks.push(chunk);
                        chunk=this.newBatchGetItemInput(table);
                        chunkSize=0;
                    }
                    // add it to the current chunk
                    chunk.RequestItems[table].Keys.push(item);
                    chunkSize++;
                });
            });
            chunks.push(chunk);

        } else {
            chunks.push(batch);
        }

        return chunks;
    }

    public test___splitBatchWriteIntoChunks(params:DocumentClient.BatchWriteItemInput, maxBatchSize?:number) : DocumentClient.BatchWriteItemInput[] {
        return this.splitBatchWriteIntoChunks(params, maxBatchSize);
    }

    private joinChunksIntoOutputBatchWrite(unprocessed:DocumentClient.BatchWriteItemOutput, remaining:DocumentClient.BatchWriteItemInput[]) : DocumentClient.BatchWriteItemOutput {

        remaining.forEach(chunk=> {
            Object.keys(chunk.RequestItems).forEach(table=> {
                if (unprocessed.UnprocessedItems[table]===undefined) {
                    unprocessed.UnprocessedItems[table]= [];
                }
                unprocessed.UnprocessedItems[table].push(...chunk.RequestItems[table]);
            });
        });

        return unprocessed;
    }

    private mergeBatchGetOutput(response:DocumentClient.BatchGetItemOutput, toMerge:DocumentClient.BatchGetItemOutput) : DocumentClient.BatchGetItemOutput {

        if (toMerge.Responses) {
            Object.keys(toMerge.Responses).forEach(table=> {
                if (response.Responses[table]===undefined) {
                    response.Responses[table]= [];
                }
                response.Responses[table].push(...toMerge.Responses[table]);
            });
        }

        if (toMerge.UnprocessedKeys) {
            Object.keys(toMerge.UnprocessedKeys).forEach(table=> {
                if (response.UnprocessedKeys[table]===undefined) {
                    response.UnprocessedKeys[table]= {Keys:[]};
                }
                response.UnprocessedKeys[table].Keys.push(...toMerge.UnprocessedKeys[table].Keys);
            });

        }

        return response;
    }

    public test___joinChunksIntoOutputBatchWrite(unprocessed:DocumentClient.BatchWriteItemOutput, remaining:DocumentClient.BatchWriteItemInput[]) : DocumentClient.BatchWriteItemOutput {
        return this.joinChunksIntoOutputBatchWrite(unprocessed, remaining);
    }

    private newBatchWriteItemInput(table?:string) : DocumentClient.BatchWriteItemInput {
        const r:DocumentClient.BatchWriteItemInput = {
            RequestItems: {}
        };
        if (table!==undefined) {
            r.RequestItems[table]= [];
        }
        return r;
    }

    private newBatchGetItemInput(table?:string) : DocumentClient.BatchGetItemInput {
        const r:DocumentClient.BatchGetItemInput = {
            RequestItems: {}
        };
        if (table!==undefined) {
            r.RequestItems[table]= {
                Keys: []
            };
        }
        return r;
    }

}
