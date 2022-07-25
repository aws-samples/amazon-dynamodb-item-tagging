/*!
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
*/

import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { AccessLogFormat, Cors, EndpointType, LambdaIntegration, LogGroupLogDestination, MethodLoggingLevel, RestApi } from 'aws-cdk-lib/aws-apigateway';
import {
    AttributeType, BillingMode, ProjectionType, Table, TableEncryption
} from 'aws-cdk-lib/aws-dynamodb';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import path from 'path';

export class DynamodbItemTaggingStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // create the DynamoDB table
    const tableName = 'tasks';
    const table = new Table(this, tableName, {
      tableName,
      partitionKey: {
        name: 'pk',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true,
    });

    // add a global secondary index to allow listing all task items
    table.addGlobalSecondaryIndex({
      indexName: 'siKey1-sk-index',
      partitionKey: {
        name: 'siKey1',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
    });

    // define the lambda function to create new tasks
    const createTaskLambda = new NodejsFunction(this, 'createTask', {
      memorySize: 256,
      timeout: Duration.seconds(5),
      runtime: Runtime.NODEJS_16_X,
      handler: 'handler',
      entry: path.join(__dirname, `/../lambda/create.handler.ts`),
      environment: {
        TABLE_NAME: tableName
      },
      bundling: {
        minify: true,
        externalModules: ['aws-sdk'],
      }
    });

    // define the lambda function to list existing tasks
    const listTasksLambda = new NodejsFunction(this, 'listTasks', {
      memorySize: 256,
      timeout: Duration.seconds(29),
      runtime: Runtime.NODEJS_16_X,
      handler: 'handler',
      entry: path.join(__dirname, `/../lambda/list.handler.ts`),
      environment: {
        TABLE_NAME: tableName
      },
      bundling: {
        minify: true,
        externalModules: ['aws-sdk'],
      },
    });

    // grant the lambda functions access to the table
    table.grantWriteData(createTaskLambda);
    table.grantReadData(listTasksLambda);
    // define the API Gateway
    const logGroup = new LogGroup(this, 'DynamoDBItemTaggingLogs');
    const api = new RestApi(this, 'amazon-dynamodb-item-tagging-api', {
      description: 'Amazon DynamoDB Item Tagging API',
      deployOptions: {
        stageName: 'prod',
        accessLogDestination: new LogGroupLogDestination(logGroup),
        accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
        loggingLevel: MethodLoggingLevel.INFO,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
      },
      endpointTypes: [EndpointType.REGIONAL]
    });

    // define the rest api endpoints to proxy through to the lambda functions
    const tasksResource = api.root.addResource('tasks');
    tasksResource.addMethod('POST', new LambdaIntegration(createTaskLambda, {proxy: true}), {apiKeyRequired: true});
    tasksResource.addMethod('GET', new LambdaIntegration(listTasksLambda, {proxy: true}), {apiKeyRequired: true});

  }
}
