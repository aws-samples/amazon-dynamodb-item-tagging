/*!
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
*/

import { APIGatewayEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DocumentClient } from 'aws-sdk/clients/dynamodb';

import { CreateService } from './create';
import ow from 'ow';
import { TaskItem } from './models';

const dc = new DocumentClient();
const tableName = process.env.TABLE_NAME as string;
const service = new CreateService(dc, tableName);

/**
 * The lambda handler function to create new task items
 */
exports.handler = async (event: APIGatewayEvent, _context: Context): Promise<APIGatewayProxyResult> => {

  try {
    // Validate the incoming item. At a minimum, it must have a name
    ow(event.body, 'request body', ow.string.nonEmpty);
    const item: TaskItem = JSON.parse(event.body);
    const saved = await service.process(item);
    
    // return the saved item
    return {
      statusCode: 201,
      body: JSON.stringify(saved),
    };
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Converts an error to an API Gateway friendly response
 * @param e 
 * @returns 
 */
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
