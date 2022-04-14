/*!
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
*/

import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { CreateService } from './create';
import { TaskItem } from './models';


describe('CreateService', () => {
    let mockedDocumentClient: DocumentClient;
    let underTest: CreateService;

    beforeEach(() => {
        mockedDocumentClient = new DocumentClient();
        underTest = new CreateService(mockedDocumentClient, 'myTable');
    });

    it('creating new task item - happy path', async () => {

        // input data
        const toSave: TaskItem = {
            name: 'my test',
            description: 'my test description',
            tags: {
                'tag1': 'value1',
                'tag2': 'value2'
            }
        };

        // mocks
        const mockedSave = mockedDocumentClient.batchWrite = jest.fn()
            .mockImplementationOnce(()=> {
                return {
                    promise: () => {
                        return {
                            UnprocessedItems: {}
                        };
                    }
                };
            });

        // test
        const saved = await underTest.process(toSave);

        // assertions
        expect(saved.id).toBeDefined();
        expect(saved.name).toEqual(toSave.name);
        expect(saved.description).toEqual(toSave.description);
        expect(saved.tags).toEqual(toSave.tags);

        const expectedBatchWriteItemInput: DocumentClient.BatchWriteItemInput = {
            RequestItems: {
                myTable: [
                    {
                        PutRequest: {
                            Item: {
                                pk: `task#${saved.id}`,
                                sk: `task#${saved.id}`,
                                siKey1: 'task',
                                name: saved.name,
                                description: saved.description,
                                tags: saved.tags
                            }
                        }
                    }, {
                        PutRequest: {
                            Item: {
                                pk: 'tag#tag1',
                                sk: `value1#task#${saved.id}`,
                            }
                        }
                    }, {
                        PutRequest: {
                            Item: {
                                pk: 'tag#tag2',
                                sk: `value2#task#${saved.id}`,
                            }
                        }
                    }
                ]
            }
        };
        expect(mockedSave).toHaveBeenCalledWith(expectedBatchWriteItemInput);

    });
});

