/*!
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
*/
export interface TaskItem {
  id?: string;
  name: string;
  description: string;
  tags?: Tags;
}

export type Tags = { [key: string]: Tag };
export type Tag = string;

export interface TaskListItem {
  items: TaskItem[];
  pagination?: {
    nextToken?: string;
    count?: number;
  }
}

export interface TaskItemListPaginationKey {
	id:string;
}

export interface TaskItemIdListPaginationKey {
	tagName?:string;
	tagValue?:string;
	id:string;
}