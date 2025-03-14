////////////////////////////////////////////////////////////////////////////
//
// Copyright 2018 Realm Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
////////////////////////////////////////////////////////////////////////////

import Realm from 'realm';
import React from 'react';

import { RealmLoadingMode, RealmToLoad } from '../../../utils/realms';
import { ILoadingProgress } from '../LoadingOverlay';

export interface IRealmLoadingComponentState {
  progress: ILoadingProgress;
}

export abstract class RealmLoadingComponent<
  P,
  S extends IRealmLoadingComponentState,
> extends React.Component<P, S> {
  protected abstract onRealmChanged: () => void;
  protected abstract onRealmSchemaChanged: () => void;
  protected abstract onRealmLoaded: () => void;

  protected realm?: Realm;
  protected cancellations: (() => void)[] = [];
  protected certificateWasRejected = false;

  public componentWillUnmount() {
    this.closeRealm();
    this.cancelLoadingRealms();
  }

  protected cancelLoadingRealms() {
    // Iterate over everything that can be cancelled
    this.cancellations.forEach(cancel => cancel());
  }

  protected async loadRealm(
    realm: RealmToLoad,
    schema?: Realm.ObjectSchema[],
    schemaVersion?: number,
  ) {
    // Close the realm - if open
    this.closeRealm();

    if (realm) {
      try {
        this.setState({ progress: { status: 'in-progress' } });
        // Reset the state that captures rejected certificates
        this.certificateWasRejected = false;
        // Get the realms from the ROS interface
        this.realm = await this.openRealm(realm, schema, schemaVersion);

        // Register change listeners
        this.realm.addListener('change', this.onRealmChanged);
        this.realm.addListener('schema', this.onRealmSchemaChanged);
        this.onRealmLoaded();
        // Update the state, to indicate we're done loading
        this.setState({ progress: { status: 'done' } });
      } catch (err) {
        // Ignore an error that originates from the load being cancelled
        if (err instanceof Error) {
          this.loadingRealmFailed(err);
        } else {
          throw new Error('Expected an Error');
        }
      }
    }
  }

  protected closeRealm() {
    // Closing and remove any existing a change listeners
    if (this.realm) {
      this.realm.removeListener('change', this.onRealmChanged);
      this.realm.removeListener('schema', this.onRealmSchemaChanged);
      this.realm.close();
      delete this.realm;
    }
  }

  protected loadingRealmFailed(err: Error) {
    const message = err.message || 'Failed to open the Realm';
    const backtraceStart = message.indexOf('Exception backtrace:');
    const summary = message.substring(0, backtraceStart);
    // Trim off useless information
    const trimmedSummary = summary.replace(/ Path:$/, '');
    const details = message.substring(backtraceStart);
    this.setState({
      progress: { message: trimmedSummary, details, status: 'failed' },
    });
  }

  private async openRealm(
    realm: RealmToLoad | undefined,
    schema?: Realm.ObjectSchema[],
    schemaVersion?: number,
  ): Promise<Realm> {
    if (realm && realm.mode === RealmLoadingMode.Local) {
      try {
        return new Realm({
          path: realm.path,
          encryptionKey: realm.encryptionKey,
          disableFormatUpgrade: realm.enableFormatUpgrade ? false : true,
          sync: realm.sync as any,
          schema,
          schemaVersion,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes('Incompatible histories.') ||
            error.message.startsWith(
              'History type (as specified by the Replication implementation passed to the DB constructor) was not consistent across the session',
            )) &&
          realm.sync !== true
        ) {
          // Try to open the Realm locally with a sync history mode.
          console.log('Trying to open sync Realm as local Realm');
          return this.openRealm(
            { ...realm, sync: true },
            schema,
            schemaVersion,
          );
        }
        // Other errors, propagate it.
        throw error;
      }
    }

    if (!realm) {
      throw new Error(`Called without a realm to load`);
    }

    throw new Error('Unexpected mode');
  }
}
