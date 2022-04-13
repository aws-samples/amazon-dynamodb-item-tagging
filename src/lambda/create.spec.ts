/*********************************************************************************************************************
 *  Copyright Amazon.com Inc. or its affiliates. All Rights Reserved.                                           *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/LICENSE-2.0                                                                    *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 *********************************************************************************************************************/
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

