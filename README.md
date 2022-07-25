# Amazon DynamoDB Item Tagging

## Summary

Amazon DynamoDB is a fast and flexible NoSQL database service for single-digit millisecond performance at any scale. But in order to provide this scalability and performance, data access patterns must be known up front so that optimum keys and indexes can be designed. This is difficult in scenarios such as allowing the users of your platform to define any attributes for their data, then search that data filtering by any number of those attributes. This pattern outlines an approach to solve this problem by demonstrating how to structure a table and its indexes within DynamoDB to allow searching, then at the application layer how to efficiently aggregate results that match the multiple requests attributes.

As an example, let's say we have a task management application which allows users to create tasks as follows:

```json
{
    "id": "TASK_001",
    "name": "Read sample",
    "description": "Walk through the sample",
    "tags": {
        "project": "self improvement",
        "priority": "high",
        "severity": "low"
    }
}
```

What is relevant here is the `tags` property. In our application we allow its users to specify their own tags against their tasks (`project`, `priority`, and `severity` in this case), as well as querying their tasks based on any number of tag attribute keys and values they provide.

## Prerequisites 

* An active AWS account
* [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) installed, with credential configured using `aws configure`
* Node.js v16. It is recommended to install and use [nvm](https://github.com/nvm-sh/nvm) to manage multiple versions of node.js
* Install AWS CDK using `npm install -g aws-cdk`
* Docker (required by AWS CDK)

## Architecture

![architecture](docs/images/architecture.png)

The infrastructure that is deployed as part of this pattern is relatively simple: an *Amazon API Gateway* proxies a `POST /tasks` REST API to a *AWS Lambda* function to save a task to *Amazon DynamoDB*. Likewise, *Amazon API Gateway* proxies a `GET /tasks` REST API to another *AWS Lambda* function that handles the querying of data. The complexity involved with this pattern is in the implementation of the querying logic carried out as part of the *List Items AWS Lambda* function.

## Database Table Design

* We take the approach of using a single Amazon DynamoDB table to store all data for the application.
* To facilitate querying items by any user defined tags, we use the [Adjacency List design pattern](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-adjacency-graphs.html#bp-adjacency-lists) to store both task and tags data as separate items in the same table.
* [Composite sort keys](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-sort-keys.html) are used to allow efficient querying of tag values.
* A single [sparse index](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-general-sparse-indexes.html) allows querying all task items when no filtering by tags has been requested.
* Within the table we store 2 types of items: `task` and `tag`:

**Task item**

Attribute name | Attribute type | Example
---|---|---
`pk` (partition key) | String | `task#<id>` e.g. `task#TASK_001`
`sk` (sort key) | String | `task#<id>` e.g. `task#TASK_001`
`siKey1` | String | `task`
`name` | String | `Read sample`
`description` | String | `Walk through the sample`
`done` | Boolean | `false`
`tags` | Map | `{ "project": "self improvement", "priority": "high", "severity": "low" }`

**Tag item**

Attribute name | Attribute type | Example
---|---|---
`pk` (partition key) | String | `tag#<tagName>` e.g. `tag#project`
`sk` (sort key) | String | `<tagValue>#task#<taskId>` e.g. `self improvement#task#001`

**Global Secondary Index**

A sparse GSI (named `siKey1-sk-index` exists with partition key `siKey1` and sort key `sk` and a projection type of `ALL` (refer to `src/infra/amazon-dynamodb-item-tagging-stack.ts` for further details). 

**Sample data**
Taking the sample task item as listed in the summary, we store this as 4 separate items within the Amazon DynamoDB table as follows (refer to `src/lambda/create.ts` for further details on the implementation):

pk (partition key) | sk (sort key) | siKey1 | name | description | done | tags
---|---|---|---|---|---|---
`task#TASK--1` | `task#TASK--1` | `task` | `Read sample` | `Walk through the sample` | `false` | `{ "project": "self improvement", "priority": "high", "severity": "low" }`
`tag#project` | `self improvement#task#001` |  
`tag#priority` | `high#task#001` |  
`tag#severity` | `low#task#001` |  

## Application implementation walkthrough

The code files of interest are:

```
src/                                        // source code
├── infra/                                  // infrastructure as code (cdk)
│   └── amazon-dynamodb-item-tagging-stack.ts      // stack implementation
│   └── amazon-dynamodb-item-tagging-.spec.ts       // stack tests
├── lambda/                                 // lambda functions
│   └── create.ts                           // create task code
│   └── create.spec.ts                      // create tasks tests
│   └── create.handler.ts                   // create task lambda handler
│   └── list.ts                             // list task code
│   └── list.spec.ts                        // list task tests
│   └── list.handler.ts                     // list task lambda handler
│   └── models.ts                           // shared models
├── utils/                                  // utils    
│   └── dynamodb.util.ts                    // dynamodb helper utils
```

#### Creating Tasks

The code for creating tasks as described in the *Database table design* section is contained within the `CreateService process(item:TaskItem)` function located in `src/lambda/create.ts`. 

This class/method is wrapped by the lambda handler defined in `src/create.handler.ts` and is invoked by the *API Gateway* proxy to the *Lambda* function as defined in `src/infra/amazon-dynamodb-item-tagging-stack.ts`. The lambda handler takes the raw `APIGatewayEvent` object and invokes the `process` method with the extracted methods.

The `CreateService` class is separated from the lambda handler to allow for unit testing (refer to `src/lambda/create.spec.ts`).


#### Listing Tasks

Similar to the create tasks logic, the listing of tasks is implemented in the `ListService process(tags?: Tags, paginationKey?: TaskItemListPaginationKey, count?: number)` function located in `src/lambda/list.ts`, wrapped by the lambda handler defined in `src/lambda/list.handler.ts`, and tested in `src/lambda/list.spec.ts`.

Finding tasks that match all requested (user defined) tags is not (efficiently or cost effectively) possible in a single query using DynamoDB. Instead we need to query the table for all tasks per each filter, then attempt to find matching tasks across those different result sets at the application layer before returning the final result set. Along the way we may need to obtain the next page of results for any of the provided tags if the requested page size is greater than the number of tasks accumulated so far. The following sequence diagrams illustrate the process that allows this to be done in an efficient and scalable manner:

```mermaid
sequenceDiagram

    title: ListService `process()` Sequence Flow

    participant lh as Lambda Handler
    participant l as ListService
    participant ddbu as DynamoDBUtils
    participant ddb as DynamoDB

    lh->>+l: process<br/>(tags?,paginationKey?,count?)

    alt tags provided
    
        l->>+l: listIds()
        note right of l: Refer to `listIds()` sequence diagram
        l-->>-l: [taskIds, paginationKey]

        opt taskids.length > 0
            l->>+l: getItemsFromDb()
            note right of l: Refer to `getItemsFromDb()` sequence diagram
            l-->>-l: tasks
        end
        
    else no tags provided
        l->>+l: listItemsFromDb()
        note right of l: Refer to `listItemsFromDb()` section within `listIds()` sequence diagram
        l-->>-l: [tasks, paginationKey]
    end

    l-->>-lh: [tasks, paginationKey]

```

```mermaid
sequenceDiagram

    title: ListService `listIds()` Sequence Flow

    participant l1 as ListService
    participant l2 as ListService
    participant ddb as DynamoDB

    l1->>+l2: listIds(tags,paginationKey,count)

    par async task per tag
        note right of l2: Retrieve the first page of task ids that match each tag
        loop each tag
            l2->>+l2: listIdsFromDbUsingTags<(tagKey,tagValue,tagPaginationKey,count)
            note right of l2: Refer to `listIdsFromDbUsingTags()` section below
            l2-->>-l2: task ids
        end
    end

    note right of l1: if any of the initial results are empty, then we can exit<br/>immediately as there are no common matches across all requested tags
    loop each tag
        opt no task ids
            l2-->>l1: [undefined, undefined]
        end
    end

    note right of l2: initialize a set of pointers that tracks the current position of each tags page of results
    l2->>l2: initialize pointers
    note right of l2: loop through each page of results per tag looking for task ids that are found across
    loop more item ids still to process and found items < requested count
        loop each tag index
            note right of l2: retrieve the next task id for the current tag to process
            l2->>+l2: currentTagTaskItemId = getNextItemIdFromResults(tagIndex)
            note right of l2: Refer to `getNextPageOfResults(tagIndex)` section below
            l2-->>-l2: task id

            alt tag index === last tag index
                note right of l2: if we reach here it means we found a task id that was matched across all tags
                l2->>l2: add currentTagTaskItemId to results
                l2->>l2: increment all the pointers to reference the next result for each tag

            else tag index < last tag index
                note right of l2: check for matching task ids between this and the next tag to be compared
                l2->>+l2: nextTagTaskItemId = getNextItemIdFromResults(tagIndex)
                note right of l2: Refer to `getNextPageOfResults(tagIndex)` section below
                l2-->>-l2: task id

                alt currentTagTaskItemId === nextTagTaskItemId
                    note right of l2: we have a match across the tag pair being checked, so lets move onto checking the next tag pair
                    l2-->>l2: continue loop

                else currentTagTaskItemId < nextTagTaskItemId
                    note right of l2: this tag has a lower task id, therefore increment the pointer for the current tag and restart the matching flow
                    l2-->>l2: increment pointer of current tag
                    l2-->>l2: break loop

                else currentTagTaskItemId > nextTagTaskItemId
                    note right of l2: this tag has a higher task id, therefore increment the pointer for the next tag and restart the matching flow
                    l2-->>l2: increment pointer of next tag
                    l2-->>l2: break loop

                end

            end
        end
    end

    l2-->>-l1: [taskIds, paginationKey]

    note right of l1: ~~~<br/>`getNextPageOfResults(tagIndex)` sequence flow<br/>~~~
    rect rgb(227, 211, 175)
        l1->>+l2: getNextItemIdFromResults(tagIndex)
        opt no more task ids in current page of results
            l2->>+l2: getNextPageOfResults(tagIndex)
            l2->>+l2: listIdsFromDbUsingTags(tagKey,tagValue,paginationKey,count)
            note right of l2: Refer to `listIdsFromDbUsingTags()` section below
            l2-->>-l2: task ids
            l2-->>-l2: has results?
        end
        l2-->>-l1: task id
        opt no next task id for current tag
            note right of l1: stop processing
        end
    end 

    note right of l1: ~~~<br/>`listIdsFromDbUsingTags(tagName,tagValue,exclusiveStart?,count?)` sequence flow<br/>~~~
    rect rgb(175, 227, 178)

        l1->>+l2: listIdsFromDbUsingTags<br/>(tagName,tagValue,exclusiveStart?,count?)

        l2->>+ddb:query(params)
        ddb-->>-l2: items

        l2->>l2: extract task ids

        l2-->>-l1: [taskIds, paginationKey]
    end

```

```mermaid
sequenceDiagram

    title: ListService `getItemsFromDb()` Sequence Flow

    participant l1 as ListService
    participant l2 as ListService
    participant ddbu as DynamoDBUtils
    participant ddb as DynamoDB

    l1->>+l2: getItemsFromDb(taskIds)

    l2->>+ddbu: batchGetAll(params)

    note right of ddbu: DynamoDB batchGet call has max limit of 25 items per request, therefore chunk these
    ddbu->>+ddbu: splitBatchGetIntoChunks(params)
    ddbu-->>-ddbu: chunks

    note right of ddbu: now process each chunk, including retries on failed items...
    loop each chunk

        ddbu->>+ddb: results = ddb:batchGet(chunk)
        ddb-->>-ddbu: results

        ddbu->>+ddbu: mergeBatchGetOutput(overallResults, chunkResults)
        ddbu-->>-ddbu: overallResults

        opt has unprocessed keys?
            note right of ddbu: recursive retry until hit max retry limit
            ddbu->>+ddbu: retriedResults = batchGetAll(params)
            ddbu-->>-ddbu: retriedResults
            ddbu->>+ddbu: mergeBatchGetOutput(overallResults, retriedResults)
            ddbu-->>-ddbu: overallResults
        end
    end

    ddbu-->>-l2: overallResults

    l2-->>-l1: items

```


## Limitations

The algorithm used to implement the application is optimized for scalability and performance. However, its effectiveness is still heavily dependent on the cardinality of data of those user defined tags.

As an example, let's say we have the following to indicate a best case scenario:

* 10,000,000 tasks
* 50 tasks tagged with `project` of `self improvement`
* 80 tasks tagged with `priority` of `high`
* 20 tasks tagged with `severity` of `low`
* 3 tasks that match all tags

Best case is that the 3 tasks with all matching tags happen to be in the first page of results we return for each tag. This would entail 60 tag item reads (a page of 20 tag items per tag) followed by 3 task item reads.

Worst case is that the 3 tasks with all matching tags happen to be in the last page of results we return for each tag. This would entail 150 tag item reads (all tag items returned) followed by 3 task item reads.

As the next example, let's say we have the following to indicate a worst case scenario:

* 10,000,000 tasks
* 1,000,000 tasks tagged with `project` of `self improvement`
* 9,000,000 tasks tagged with `priority` of `high`
* 2,000,000 tasks tagged with `severity` of `low`
* 3 tasks that match all tags

Best case is that the 3 tasks with all matching tags happen to be in the first page of results we return for each tag. Like the last example, this would entail 60 tag item reads (a page of 20 tag items per tag) followed by 3 task item reads.

Worst case is that the 3 tasks with all matching tags happen to be in the last page of results we return for each tag. This would entail 12,000,000 tag item reads (all tag items returned) followed by 3 task item reads. 

That last example would be a very expensive query, as well as likely to exceed the Lambda function execution timeout. To alleviate this, the concept of composite tags could be used to reduce the number of tag item reads. For example, we could have a user defined composite tag `project_priority_severity` in addition to the existing as follows:

* 10,000,000 tasks
* 1,000,000 tasks tagged with `project` of `self improvement`
* 9,000,000 tasks tagged with `priority` of `high`
* 2,000,000 tasks tagged with `severity` of `low`
* 3 tasks tagged with `project_priority_severity` of `self improvement_high_low`

Both best and worst case scenarios of instead searching just using the composite tag results in 3 tag item reads and 3 task item reads.

## Deployment Steps

* Ensure all [prerequisites](#prerequisites) are met
* Clone this repository, and `cd` into its directory
* Build the application using `npm run build`
* Deploy the application using `cdk deploy --outputs-file ./cdk-outputs.json`
* Open `./cdk-outputs.json` and make a note of the  API Gateway URL where the application's REST API is deployed
* The following is an example of how to create new tasks

```http
POST /tasks HTTP/1.1

Request Headers:
    Accept: application/json
    Content-Type: application/json

Request Body:
    {
        "name": "Read sample",
        "description": "Walk through the sample",
        "tags": {
            "project": "self improvement",
            "priority": "high",
            "severity": "low"
        }
    }

Response Status: 
    201

Response Body:
    {
        "id": "d72hsy2is",
        "name": "Read sample",
        "description": "Walk through the sample",
        "tags": {
            "project": "self improvement",
            "priority": "high",
            "severity": "low"
        }
    }
```

* The following is an example of how to query tasks

```http
GET /tasks?tag=priority:high&tag=severity:low HTTP/1.1

Request Headers:
    Accept: application/json
    Content-Type: application/json

Response Status: 
    200

Response Body:
    {
        "items": [
            "id": "d72hsy2is",
            "name": "Read sample",
            "description": "Walk through the sample",
            "tags": {
                "project": "self improvement",
                "priority": "high",
                "severity": "low"
            }
        ]
    }
```


## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run lint`    lint the code
 * `npm run test`    perform the jest unit tests
 * `cdk synth`       emits the synthesized CloudFormation template
 * `cdk diff`        compare deployed stack with current state
 * `cdk deploy`      deploy this stack to your default AWS account/region

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
