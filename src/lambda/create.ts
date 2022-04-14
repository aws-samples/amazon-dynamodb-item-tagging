/*!
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
*/

import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import ow from 'ow';
import ShortUniqueId from 'short-unique-id';

import { DynamoDbUtils } from '../utils/dynamoDb.util';
import { TaskItem } from './models';


export class CreateService {

  private readonly dynamoDbUtils: DynamoDbUtils;
  private readonly uidGenerator: ShortUniqueId;

  public constructor(
    dc: DocumentClient,
    private tableName: string
  ) {
    this.dynamoDbUtils = new DynamoDbUtils(dc);
    this.uidGenerator = new ShortUniqueId({
      dictionary: 'alphanum_lower',
      length: 9,
    });
  }

  public async process(item: TaskItem): Promise<TaskItem> {

    // Validate the incoming item. At a minimum, it must have a name
    ow(item?.name, 'name', ow.string.nonEmpty);

    // set attributes we need to before saving
    item.id = this.uidGenerator();

    // Save it to the database. 
    await this.saveToDb(item);

    // return the saved item
    return item;
  }

  /**
   * Saves a new TaskItem to the database
   * @param item 
   */
  private async saveToDb(item: TaskItem): Promise<void> {

    // as we are writing potentially multiple items (the task item, along with its tags), we need to use BatchWriteItem
    const params: DocumentClient.BatchWriteItemInput = {
      RequestItems: {
      }
    };
    params.RequestItems[this.tableName] = [];

    // first lets write the TaskItem as its own DynamoDB item. We include the tags to simplify retrieval later
    const taskDbItem: DocumentClient.WriteRequest = {
      PutRequest: {
        Item: {
          // we set the pk and sk to the item id. we prefix both with `task#` to allow filtering by task items
          pk: `task#${item.id}`,
          sk: `task#${item.id}`,
          // we are using a gsi to allow listing all items of a certain type, which in this case is task items
          // task: GSI key sharding
          siKey1: 'task',
          name: item.name,
          description: item.description,
          // tags are duplicated here to simplify retrieval
          tags: item.tags
        }
      }
    };
    params.RequestItems[this.tableName].push(taskDbItem);

    // next we write all the tags as separate DynamoDB items. We use the tag name as the partition key, and the tag value and the TaskItem id as a composite sort key.
    if (item.tags) {
      Object.entries(item.tags).forEach(([tagName, tagValue]) => {
        const tagDbItem: DocumentClient.WriteRequest = {
          PutRequest: {
            Item: {
              pk: `tag#${tagName}`,
              sk: `${tagValue}#task#${item.id}`,
            }
          }
        };
        params.RequestItems[this.tableName].push(tagDbItem);
      });
    }

    const r = await this.dynamoDbUtils.batchWriteAll(params);
    if (this.dynamoDbUtils.hasUnprocessedItems(r)) {
      throw new Error('SAVE_FAILED');
    }

  }
}
