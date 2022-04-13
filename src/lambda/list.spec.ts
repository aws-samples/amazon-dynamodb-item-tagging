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
import { ListService } from './list';
import { Tags, TaskItemListPaginationKey } from './models';


describe('ListService', () => {

    let mockedDocumentClient: DocumentClient;
    let underTest: ListService;

    beforeEach(() => {
        mockedDocumentClient = new DocumentClient();
        underTest = new ListService(mockedDocumentClient, 'myTable');
    });

    it('listing items with multiple tags - happy path', async () => {

        /* 
            input data
        */
        const tags: Tags = {
            'tag1': 'value1',
            'tag2': 'value2',
            'tag3': 'value3'
        };

        /*
            mocks
        */
        const mockedQuery = mockedDocumentClient.query = jest.fn()
            // mock 1st page of results for tag1
            .mockImplementationOnce(() => mockQueryOutput(
                ['value1#task#001', 'value1#task#003', 'value1#task#005', 'value1#task#007', 'value1#task#009', 'value1#task#011'].map(v => ({ sk: v })), 
                { pk: 'tag#tag1', sk: 'value1#task#011' })
            )
            // mock 1st page of results for tag2
            .mockImplementationOnce(() => mockQueryOutput(
                ['value2#task#001', 'value2#task#005', 'value2#task#009', 'value2#task#013'].map(v => ({ sk: v })))
            )
            // mock 1st page of results for tag3
            .mockImplementationOnce(() => mockQueryOutput(
                ['value3#task#001', 'value3#task#009', 'value3#task#017', 'value3#task#025'].map(v => ({ sk: v })))
            )
            // mock 2nd page of results for tag1
            .mockImplementationOnce(() => mockQueryOutput(
                ['value1#task#013', 'value1#task#015', 'value1#task#017', 'value1#task#019', 'value1#task#021', 'value1#task#023'].map(v => ({ sk: v })))
            );


        // mock retrieving the items where the tags match
        const mockedBatchGet = mockedDocumentClient.batchGet = jest.fn()
            .mockImplementationOnce(() => mockedBatchGetItemOutput('myTable', [
                {
                    pk: 'task#001',
                    sk: 'task#001',
                    name: 'item1',
                    description: 'item1 description',
                    tags: {
                        'tag1': 'value1',
                        'tag2': 'value2',
                        'tag3': 'value3'
                    }
                },
                {
                    pk: 'task#009',
                    sk: 'task#009',
                    name: 'item9',
                    description: 'item9 description',
                    tags: {
                        'tag1': 'value1',
                        'tag2': 'value2',
                        'tag3': 'value3'
                    }
                }
            ])
            );

        /* 
            test
        */
        const results = await underTest.process(tags);

        /*
            assertions
        */
        // correct number of results returned
        expect(results?.[0]?.length).toBe(2);

        // 1st result is as expected
        expect(results?.[0]?.[0]).toStrictEqual({
            id: '001',
            name: 'item1',
            description: 'item1 description',
            tags: {
                'tag1': 'value1',
                'tag2': 'value2',
                'tag3': 'value3'
            }
        });

        // 2nd result is as expected
        expect(results?.[0]?.[1]).toStrictEqual({
            id: '009',
            name: 'item9',
            description: 'item9 description',
            tags: {
                'tag1': 'value1',
                'tag2': 'value2',
                'tag3': 'value3'
            }
        });

        // should be no pagination returned
        expect(results[1]).toBeUndefined();

        // 1st database call should be `query` for page 1 of tag 1 items
        const expectedQueryInput1: DocumentClient.QueryInput = {
            TableName: 'myTable',
            KeyConditionExpression: `#hash = :hash AND begins_with(#sort,:sort)`,
            ExpressionAttributeNames: {
                '#hash': 'pk',
                '#sort': 'sk',
            },
            ExpressionAttributeValues: {
                ':hash': 'tag#tag1',
                ':sort': 'value1#task#',
            },
            ExclusiveStartKey: undefined,
            Limit: 20
        };
        expect(mockedQuery.mock.calls[0][0]).toStrictEqual(expectedQueryInput1);

        // 2nd database call should be `query` for page 1 of tag 2 items
        const expectedQueryInput2: DocumentClient.QueryInput = Object.assign({}, expectedQueryInput1);
        expectedQueryInput2.ExpressionAttributeValues = {
            ':hash': 'tag#tag2',
            ':sort': 'value2#task#',
        };
        expect(mockedQuery.mock.calls[1][0]).toStrictEqual(expectedQueryInput2);

        // 3rd database call should be `query` for page 1 of tag 3 items
        const expectedQueryInput3: DocumentClient.QueryInput = Object.assign({}, expectedQueryInput1);
        expectedQueryInput3.ExpressionAttributeValues = {
            ':hash': 'tag#tag3',
            ':sort': 'value3#task#',
        };
        expect(mockedQuery.mock.calls[2][0]).toStrictEqual(expectedQueryInput3);

        // 4th database call should be `query` for page 2 of tag 1 items
        const expectedQueryInput4: DocumentClient.QueryInput = Object.assign({}, expectedQueryInput1);
        expectedQueryInput4.ExclusiveStartKey = {
            pk: 'tag#tag1',
            sk: 'value1#task#011'
        };
        expect(mockedQuery.mock.calls[3][0]).toStrictEqual(expectedQueryInput4);

        // 5th database call should be `batchget` for the matching items
        const expectedBatchGet: DocumentClient.BatchGetItemInput = {
            RequestItems: {
                'myTable': {
                    Keys: [
                        {
                            pk: 'task#001',
                            sk: 'task#001'
                        },
                        {
                            pk: 'task#009',
                            sk: 'task#009'
                        }
                    ]
                }
            }
        };
        expect(mockedBatchGet.mock.calls[0][0]).toStrictEqual(expectedBatchGet);
    });

    it('listing items with multiple tags involving many pagination\'s of tag items', async () => {

        /* 
            input data
        */
        const tags: Tags = {
            'tag1': 'value1',
            'tag2': 'value2',
            'tag3': 'value3'
        };

        /*
            mocks
        */
        const mockedQuery = mockedDocumentClient.query = jest.fn()
            // mock 1st page of results for tag1
            .mockImplementationOnce(() => mockQueryOutput(
                ['value1#task#001', 'value1#task#003', 'value1#task#005', 'value1#task#007'].map(v => ({ sk: v })), { pk: 'tag#tag1', sk: 'value1#task#007' })
            )
            // mock 1st page of results for tag2
            .mockImplementationOnce(() => mockQueryOutput(
                ['value2#task#001', 'value2#task#005', 'value2#task#009', 'value2#task#013'].map(v => ({ sk: v })), { pk: 'tag#tag2', sk: 'value2#task#013' })
            )
            // mock 1st page of results for tag3
            .mockImplementationOnce(() => mockQueryOutput(
                ['value3#task#001', 'value3#task#009', 'value3#task#017', 'value3#task#025'].map(v => ({ sk: v })), { pk: 'tag#tag3', sk: 'value3#task#025' })
            )
            // mock 2nd page of results for tag1
            .mockImplementationOnce(() => mockQueryOutput(
                ['value1#task#009', 'value1#task#011', 'value1#task#013', 'value1#task#015'].map(v => ({ sk: v })), { pk: 'tag#tag1', sk: 'value1#task#015' })
            )
            // mock 2nd page of results for tag2
            .mockImplementationOnce(() => mockQueryOutput(
                ['value2#task#017', 'value2#task#021', 'value2#task#025', 'value2#task#029'].map(v => ({ sk: v })), { pk: 'tag#tag2', sk: 'value2#task#029' })
            )
            // mock 3rd page of results for tag1
            .mockImplementationOnce(() => mockQueryOutput(
                ['value1#task#017', 'value1#task#019', 'value1#task#021', 'value1#task#023'].map(v => ({ sk: v })), { pk: 'tag#tag1', sk: 'value1#task#023' })
            )
            // mock 4th and final page of results for tag1
            .mockImplementationOnce(() => mockQueryOutput(
                ['value1#task#025', 'value1#task#027'].map(v => ({ sk: v })))
            );        

        // mock retrieving the items where the tags match
        const mockedBatchGet = mockedDocumentClient.batchGet = jest.fn()
            .mockImplementationOnce(() => mockedBatchGetItemOutput('myTable', [
                {
                    pk: 'task#001',
                    sk: 'task#001',
                    name: 'item1',
                    description: 'item1 description',
                    tags: {
                        'tag1': 'value1',
                        'tag2': 'value2',
                        'tag3': 'value3'
                    }
                },
                {
                    pk: 'task#009',
                    sk: 'task#009',
                    name: 'item9',
                    description: 'item9 description',
                    tags: {
                        'tag1': 'value1',
                        'tag2': 'value2',
                        'tag3': 'value3'
                    }
                },
                {
                    pk: 'task#017',
                    sk: 'task#017',
                    name: 'item17',
                    description: 'item17 description',
                    tags: {
                        'tag1': 'value1',
                        'tag2': 'value2',
                        'tag3': 'value3'
                    }
                },
                {
                    pk: 'task#025',
                    sk: 'task#025',
                    name: 'item25',
                    description: 'item25 description',
                    tags: {
                        'tag1': 'value1',
                        'tag2': 'value2',
                        'tag3': 'value3'
                    }
                }
            ])
        );

        /* 
            test
        */
        const results = await underTest.process(tags);

        /*
            assertions
        */
        // correct number of results returned
        expect(results?.[0]?.length).toBe(4);

        // 1st result is as expected
        expect(results?.[0]?.[0]).toStrictEqual({
            id: '001',
            name: 'item1',
            description: 'item1 description',
            tags: {
                'tag1': 'value1',
                'tag2': 'value2',
                'tag3': 'value3'
            }
        });

        // 2nd result is as expected
        expect(results?.[0]?.[1]).toStrictEqual({
            id: '009',
            name: 'item9',
            description: 'item9 description',
            tags: {
                'tag1': 'value1',
                'tag2': 'value2',
                'tag3': 'value3'
            }
        });

        // 3rd result is as expected
        expect(results?.[0]?.[2]).toStrictEqual({
            id: '017',
            name: 'item17',
            description: 'item17 description',
            tags: {
                'tag1': 'value1',
                'tag2': 'value2',
                'tag3': 'value3'
            }
        });

        // 4th result is as expected
        expect(results?.[0]?.[3]).toStrictEqual({
            id: '025',
            name: 'item25',
            description: 'item25 description',
            tags: {
                'tag1': 'value1',
                'tag2': 'value2',
                'tag3': 'value3'
            }
        });


        // should be no pagination returned
        expect(results[1]).toBeUndefined();

        // 1st database call should be `query` for page 1 of tag 1 items
        const expectedQueryInput1: DocumentClient.QueryInput = {
            TableName: 'myTable',
            KeyConditionExpression: `#hash = :hash AND begins_with(#sort,:sort)`,
            ExpressionAttributeNames: {
                '#hash': 'pk',
                '#sort': 'sk',
            },
            ExpressionAttributeValues: {
                ':hash': 'tag#tag1',
                ':sort': 'value1#task#',
            },
            ExclusiveStartKey: undefined,
            Limit: 20
        };
        expect(mockedQuery.mock.calls[0][0]).toStrictEqual(expectedQueryInput1);

        // 2nd database call should be `query` for page 1 of tag 2 items
        const expectedQueryInput2: DocumentClient.QueryInput = Object.assign({}, expectedQueryInput1);
        expectedQueryInput2.ExpressionAttributeValues = {
            ':hash': 'tag#tag2',
            ':sort': 'value2#task#',
        };
        expect(mockedQuery.mock.calls[1][0]).toStrictEqual(expectedQueryInput2);

        // 3rd database call should be `query` for page 1 of tag 3 items
        const expectedQueryInput3: DocumentClient.QueryInput = Object.assign({}, expectedQueryInput1);
        expectedQueryInput3.ExpressionAttributeValues = {
            ':hash': 'tag#tag3',
            ':sort': 'value3#task#',
        };
        expect(mockedQuery.mock.calls[2][0]).toStrictEqual(expectedQueryInput3);

        // 4th database call should be `query` for page 2 of tag 1 items
        const expectedQueryInput4: DocumentClient.QueryInput = Object.assign({}, expectedQueryInput1);
        expectedQueryInput4.ExclusiveStartKey = {
            pk: 'tag#tag1',
            sk: 'value1#task#007'
        };
        expect(mockedQuery.mock.calls[3][0]).toStrictEqual(expectedQueryInput4);

        // 5th database call should be `query` for page 2 of tag 2 items
        const expectedQueryInput5: DocumentClient.QueryInput = Object.assign({}, expectedQueryInput2);
        expectedQueryInput5.ExclusiveStartKey = {
            pk: 'tag#tag2',
            sk: 'value2#task#013'
        };
        expect(mockedQuery.mock.calls[4][0]).toStrictEqual(expectedQueryInput5);

        // 6th database call should be `query` for page 3 of tag 1 items
        const expectedQueryInput6: DocumentClient.QueryInput = Object.assign({}, expectedQueryInput1);
        expectedQueryInput6.ExclusiveStartKey = {
            pk: 'tag#tag1',
            sk: 'value1#task#015'
        };
        expect(mockedQuery.mock.calls[5][0]).toStrictEqual(expectedQueryInput6);

        // 7th database call should be `query` for page 4 of tag 1 items
        const expectedQueryInput7: DocumentClient.QueryInput = Object.assign({}, expectedQueryInput1);
        expectedQueryInput7.ExclusiveStartKey = {
            pk: 'tag#tag1',
            sk: 'value1#task#023'
        };
        expect(mockedQuery.mock.calls[6][0]).toStrictEqual(expectedQueryInput7);

        // 8th database call should be `batchget` for the matching items
        const expectedBatchGet: DocumentClient.BatchGetItemInput = {
            RequestItems: {
                'myTable': {
                    Keys: [
                        { pk: 'task#001', sk: 'task#001' },
                        { pk: 'task#009', sk: 'task#009' },
                        { pk: 'task#017', sk: 'task#017' },
                        { pk: 'task#025', sk: 'task#025' },
                    ]
                }
            }
        };
        expect(mockedBatchGet.mock.calls[0][0]).toStrictEqual(expectedBatchGet);
    });

    it('listing items with multiple tags with pagination', async () => {

        /* 
            input data
        */
        const tags: Tags = {
            'tag1': 'value1',
            'tag2': 'value2',
            'tag3': 'value3'
        };
        const paginationKey: TaskItemListPaginationKey = {
            id: '011'
        };
        const count = 2;

        /*
            mocks
        */
        const mockedQuery = mockedDocumentClient.query = jest.fn()
            // mock 1st page of results for tag1
            .mockImplementationOnce(() => mockQueryOutput(
                ['value1#task#011', 'value1#task#013', 'value1#task#015', 'value1#task#017'].map(v => ({ sk: v })), { pk: 'tag#tag1', sk: 'value1#task#017' })
            )
            // mock 1st page of results for tag2
            .mockImplementationOnce(() => mockQueryOutput(
                ['value2#task#013', 'value2#task#017', 'value2#task#021', 'value2#task#025'].map(v => ({ sk: v })), { pk: 'tag#tag2', sk: 'value2#task#025' })
            )
            // mock 1st page of results for tag3
            .mockImplementationOnce(() => mockQueryOutput(
                ['value3#task#017', 'value3#task#025', 'value3#task#033', 'value3#task#041'].map(v => ({ sk: v })), { pk: 'tag#tag3', sk: 'value3#task#041' })
            )
            // mock 2nd page of results for tag1
            .mockImplementationOnce(() => mockQueryOutput(
                ['value1#task#019', 'value1#task#021', 'value1#task#023', 'value1#task#025'].map(v => ({ sk: v })), { pk: 'tag#tag1', sk: 'value1#task#025' })
            );        

        // mock retrieving the items where the tags match
        const mockedBatchGet = mockedDocumentClient.batchGet = jest.fn()
            .mockImplementationOnce(() => mockedBatchGetItemOutput('myTable', [
                {
                    pk: 'task#017',
                    sk: 'task#017',
                    name: 'item17',
                    description: 'item17 description',
                    tags: {
                        'tag1': 'value1',
                        'tag2': 'value2',
                        'tag3': 'value3'
                    }
                },
                {
                    pk: 'task#025',
                    sk: 'task#025',
                    name: 'item25',
                    description: 'item25 description',
                    tags: {
                        'tag1': 'value1',
                        'tag2': 'value2',
                        'tag3': 'value3'
                    }
                }
            ])
        );

        /* 
            test
        */
        const results = await underTest.process(tags, paginationKey, count);

        /*
            assertions
        */
        // correct number of results returned
        expect(results?.[0]?.length).toBe(2);

        // 1st result is as expected
        expect(results?.[0]?.[0]).toStrictEqual({
            id: '017',
            name: 'item17',
            description: 'item17 description',
            tags: {
                'tag1': 'value1',
                'tag2': 'value2',
                'tag3': 'value3'
            }
        });

        // 2nd result is as expected
        expect(results?.[0]?.[1]).toStrictEqual({
            id: '025',
            name: 'item25',
            description: 'item25 description',
            tags: {
                'tag1': 'value1',
                'tag2': 'value2',
                'tag3': 'value3'
            }
        });

        // pagination returned is as expected
        const expectedPaginationKey: TaskItemListPaginationKey = {
            id: '025'
        };
        expect(results[1]).toStrictEqual(expectedPaginationKey);

        // 1st database call should be `query` for page 1 of tag 1 items
        const expectedQueryInput1: DocumentClient.QueryInput = {
            TableName: 'myTable',
            KeyConditionExpression: `#hash = :hash AND begins_with(#sort,:sort)`,
            ExpressionAttributeNames: {
                '#hash': 'pk',
                '#sort': 'sk',
            },
            ExpressionAttributeValues: {
                ':hash': 'tag#tag1',
                ':sort': 'value1#task#',
            },
            ExclusiveStartKey: {
                pk: 'tag#tag1',
                sk: 'value1#task#011'
            },
            Limit: count
        };
        expect(mockedQuery.mock.calls[0][0]).toStrictEqual(expectedQueryInput1);

        // 2nd database call should be `query` for page 1 of tag 2 items
        const expectedQueryInput2: DocumentClient.QueryInput = Object.assign({}, expectedQueryInput1);
        expectedQueryInput2.ExpressionAttributeValues = {
            ':hash': 'tag#tag2',
            ':sort': 'value2#task#',
        };
        expectedQueryInput2.ExclusiveStartKey = {
            pk: 'tag#tag2',
            sk: 'value2#task#011'
        }
        expect(mockedQuery.mock.calls[1][0]).toStrictEqual(expectedQueryInput2);

        // 3rd database call should be `query` for page 1 of tag 3 items
        const expectedQueryInput3: DocumentClient.QueryInput = Object.assign({}, expectedQueryInput1);
        expectedQueryInput3.ExpressionAttributeValues = {
            ':hash': 'tag#tag3',
            ':sort': 'value3#task#',
        };
        expectedQueryInput3.ExclusiveStartKey = {
            pk: 'tag#tag3',
            sk: 'value3#task#011'
        }
        expect(mockedQuery.mock.calls[2][0]).toStrictEqual(expectedQueryInput3);

        // 4th database call should be `query` for page 2 of tag 1 items
        const expectedQueryInput4: DocumentClient.QueryInput = Object.assign({}, expectedQueryInput1);
        expectedQueryInput4.ExclusiveStartKey = {
            pk: 'tag#tag1',
            sk: 'value1#task#017'
        };
        expect(mockedQuery.mock.calls[3][0]).toStrictEqual(expectedQueryInput4);

        // 5th database call should be `batchget` for the matching items
        const expectedBatchGet: DocumentClient.BatchGetItemInput = {
            RequestItems: {
                'myTable': {
                    Keys: [
                        { pk: 'task#017', sk: 'task#017' },
                        { pk: 'task#025', sk: 'task#025' },
                    ]
                }
            }
        };
        expect(mockedBatchGet.mock.calls[0][0]).toStrictEqual(expectedBatchGet);
    });

    it('listing items with no tags - happy path', async () => {

        /*
            mocks
        */
        const mockedQuery = mockedDocumentClient.query = jest.fn()
            // mock 1st page of results
            .mockImplementationOnce(() => mockQueryOutput([
                {
                    pk: 'task#001',
                    sk: 'task#001',
                    name: 'item1',
                    description: 'item1 description',
                    tags: {
                        tag1: 'value1'
                    },
                },
                {
                    pk: 'task#002',
                    sk: 'task#002',
                    name: 'item2',
                    description: 'item2 description',
                }])
            );

        /* 
            test
        */
        const results = await underTest.process();

        /*
            assertions
        */
        // correct number of results returned
        expect(results?.[0]?.length).toBe(2);

        // 1st result is as expected
        expect(results?.[0]?.[0]).toStrictEqual({
            id: '001',
            name: 'item1',
            description: 'item1 description',
            tags: {
                tag1: 'value1'
            },
        });

        // 2nd result is as expected
        expect(results?.[0]?.[1]).toStrictEqual({
            id: '002',
            name: 'item2',
            description: 'item2 description',
            tags: undefined,
        });

        // should be no pagination returned
        expect(results[1]).toBeUndefined();

        // 1st database call should be `query` for page 1 of items
        const expectedQueryInput1: DocumentClient.QueryInput = {
            TableName: 'myTable',
            IndexName: 'siKey1-sk-index',
            KeyConditionExpression: `#hash = :hash`,
            ExpressionAttributeNames: {
                '#hash': 'siKey1',
            },
            ExpressionAttributeValues: {
                ':hash': 'task',
            },
            Select: 'ALL_ATTRIBUTES',
            ExclusiveStartKey: undefined,
            Limit: 20
        };
        expect(mockedQuery.mock.calls[0][0]).toStrictEqual(expectedQueryInput1);

    });

    it('listing items with no tags with pagination', async () => {

        /* 
            input data
        */
        const tags: Tags = undefined;
        const paginationKey: TaskItemListPaginationKey = {
            id: '003'
        };
        const count = 2;

        /*
            mocks
        */
        const mockedQuery = mockedDocumentClient.query = jest.fn()
            // mock 1st page of results
            .mockImplementationOnce(() => mockQueryOutput([
                {
                    pk: 'task#004',
                    sk: 'task#004',
                    name: 'item4',
                    description: 'item4 description',
                    tags: {
                        tag1: 'value1'
                    },
                },
                {
                    pk: 'task#005',
                    sk: 'task#005',
                    name: 'item5',
                    description: 'item5 description',
                }],
                {
                    pk: 'task#005',
                    sk: 'task#005',
                    siKey1: 'task',
                })
            );

        /* 
            test
        */
        const results = await underTest.process(tags, paginationKey, count);

        /*
            assertions
        */
        // correct number of results returned
        expect(results?.[0]?.length).toBe(2);

        // 1st result is as expected
        expect(results?.[0]?.[0]).toStrictEqual({
            id: '004',
            name: 'item4',
            description: 'item4 description',
            tags: {
                tag1: 'value1'
            },
        });

        // 2nd result is as expected
        expect(results?.[0]?.[1]).toStrictEqual({
            id: '005',
            name: 'item5',
            description: 'item5 description',
            tags: undefined,
        });

        // pagination returned is as expected
        const expectedPaginationKey: TaskItemListPaginationKey = {
            id: '005'
        };
        expect(results[1]).toStrictEqual(expectedPaginationKey);

        // 1st database call should be `query` for page 1 of items
        const expectedQueryInput1: DocumentClient.QueryInput = {
            TableName: 'myTable',
            IndexName: 'siKey1-sk-index',
            KeyConditionExpression: `#hash = :hash`,
            ExpressionAttributeNames: {
                '#hash': 'siKey1',
            },
            ExpressionAttributeValues: {
                ':hash': 'task',
            },
            Select: 'ALL_ATTRIBUTES',
            ExclusiveStartKey: {
                pk: 'task#003',
                sk: 'task#003',
                siKey1: 'task',
            },
            Limit: count
        };
        expect(mockedQuery.mock.calls[0][0]).toStrictEqual(expectedQueryInput1);

    });

    function mockQueryOutput(items: unknown[], lastEvaluatedKey?: DocumentClient.Key): { promise: () => DocumentClient.QueryOutput } {
        const mocked: DocumentClient.QueryOutput = {
            Items: items,
            LastEvaluatedKey: lastEvaluatedKey,
            Count: items?.length ?? 0
        };
        return {
            promise: () => mocked
        };
    }

    function mockedBatchGetItemOutput(tableName: string, items: unknown[]): { promise: () => DocumentClient.BatchGetItemOutput } {
        const mocked: DocumentClient.BatchGetItemOutput = {
            Responses: {
                [tableName]: items
            }
        };
        return {
            promise: () => mocked
        };
    }
});
