import { ExtensionRegistry, type ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { nodes, nodeTools, nodeResources, commands, menus, panels, settings, canvasSideTabs, pages, layouts, navigation, themes, applicationActions, agentTools, projectData, syncTransports, callScripts } from "@infinite-canvas/plugin-sdk/builtin";
import { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { usePluginStore } from "@workbench/stores/use-plugin-store";

export const pluginRegistry = new ExtensionRegistry();
const scope = new PluginScope();
export const workspaceBinding: ScopeBinding = { kind: "workspace", workspaceId: "workbench", signal: scope.signal };
export const applicationBinding: ScopeBinding = { kind: "application", signal: scope.signal };
export const builtinPlugin = pluginRegistry.createInstance({ id: "builtin", scope });
builtinPlugin.register({ extensionPoints: [nodes, nodeTools, nodeResources, projectData, syncTransports, callScripts, commands, agentTools, menus, panels, settings, canvasSideTabs, pages, layouts, navigation, themes, applicationActions] });
pluginRegistry.subscribeAll(() => usePluginStore.setState((state) => ({ revision: state.revision + 1 })));
