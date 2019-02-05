import * as fs from 'fs';
import * as path from 'path';
import { FileChangeType, FileEvent, Location, Position, Range } from 'vscode-languageserver';
import URI from 'vscode-uri';
import { onCreatedCustomComponent, onDeletedCustomComponent, onIndexCustomComponents } from '../config';
import { WorkspaceContext, AttributeInfo, TagInfo } from 'lightning-lsp-common';
import { compileFile, extractAttributes, getMethods, getProperties, toVSCodeRange } from '../javascript/compiler';
import { Metadata } from '@lwc/babel-plugin-component';
import { utils, shared, componentUtil } from 'lightning-lsp-common';
import { join } from 'path';
import { promisify } from 'util';
const { WorkspaceType } = shared;
const LWC_TAGS: Map<string, TagInfo> = new Map();

const readFile = promisify(fs.readFile);

export function resetCustomComponents() {
    LWC_TAGS.clear();
}

export async function updateCustomComponentIndex(updatedFiles: FileEvent[], context: WorkspaceContext) {
    const isSfdxProject = context.type === WorkspaceType.SFDX;
    updatedFiles.forEach(f => {
        if (f.uri.match(`.*${path.sep}lwc${path.sep}.*.js`)) {
            const file = URI.parse(f.uri).fsPath;
            if (componentUtil.isJSComponent(file)) {
                if (f.type === FileChangeType.Created) {
                    addCustomTagFromFile(file, isSfdxProject);
                    onCreatedCustomComponent(context, file);
                } else if (f.type === FileChangeType.Deleted) {
                    removeCustomTagFromFile(file, isSfdxProject);
                    onDeletedCustomComponent(context, file);
                }
            }
        }
    });
}

export function getLwcTags(): Map<string, TagInfo> {
    return LWC_TAGS;
}

export function getLwcByTag(tag: string): TagInfo {
    return LWC_TAGS.get(tag);
}

const LWC_STANDARD: string = 'lwc-standard.json';
const RESOURCES_DIR = '../resources';

export function getlwcStandardResourcePath() {
    return join(__dirname, RESOURCES_DIR, LWC_STANDARD);
}

export async function loadStandardComponents(): Promise<void> {
    const data = await readFile(getlwcStandardResourcePath(), 'utf-8');
    const lwcStandard = JSON.parse(data);
    for (const tag in lwcStandard) {
        if (lwcStandard.hasOwnProperty(tag) && typeof tag === 'string') {
            const info = new TagInfo(true, []);
            if (lwcStandard[tag].attributes) {
                lwcStandard[tag].attributes.map((a: any) => {
                    const name = a.name.replace(/([A-Z])/g, (match: string) => `-${match.toLowerCase()}`);
                    info.attributes.push(new AttributeInfo(name, a.description, a.type, undefined, 'LWC standard attribute'));
                });
            }
            info.documentation = lwcStandard[tag].description;
            LWC_TAGS.set('lightning-' + tag, info);
        }
    }
}

function removeCustomTag(tag: string) {
    LWC_TAGS.delete(tag);
}

function addCustomTag(tag: string, uri: string, metadata: Metadata) {
    const doc = metadata.doc;
    const attributes = extractAttributes(metadata, uri);
    // declarationLoc may be undefined if live file doesn't extend LightningElement yet
    const range = metadata.declarationLoc ? toVSCodeRange(metadata.declarationLoc) : Range.create(Position.create(0, 0), Position.create(0, 0));
    const location = Location.create(uri, range);
    const namespace = tag.split('-')[0];
    LWC_TAGS.set(tag, new TagInfo(true, attributes, location, doc, tag, namespace, getProperties(metadata), getMethods(metadata)));
}

export async function indexCustomComponents(context: WorkspaceContext): Promise<void> {
    const files = context.findAllModules();

    await loadCustomTagsFromFiles(files, context.type === WorkspaceType.SFDX);
    onIndexCustomComponents(context, files);
}

async function loadCustomTagsFromFiles(filePaths: string[], sfdxProject: boolean) {
    const startTime = process.hrtime();
    for (const file of filePaths) {
        await addCustomTagFromFile(file, sfdxProject);
    }
    console.log('loadCustomTagsFromFiles: processed ' + filePaths.length + ' files in ' + utils.elapsedMillis(startTime));
}

export async function addCustomTagFromFile(file: string, sfdxProject: boolean) {
    const tag = componentUtil.tagFromFile(file, sfdxProject);
    if (tag) {
        // get attributes from compiler metadata
        try {
            const { metadata, diagnostics } = await compileFile(file);
            if (diagnostics.length > 0) {
                console.log('error compiling ' + file + ': ', diagnostics);
            }
            if (metadata) {
                const uri = URI.file(path.resolve(file)).toString();
                addCustomTag(tag, uri, metadata);
            }
        } catch (error) {
            console.log('error compiling ' + file, error);
        }
    }
}

export function addCustomTagFromResults(uri: string, metadata: Metadata, sfdxProject: boolean) {
    const tag = componentUtil.tagFromFile(URI.parse(uri).fsPath, sfdxProject);
    if (tag) {
        addCustomTag(tag, uri, metadata);
    }
}

function removeCustomTagFromFile(file: string, sfdxProject: boolean) {
    const tag = componentUtil.tagFromFile(file, sfdxProject);
    if (tag) {
        removeCustomTag(tag);
    }
}
