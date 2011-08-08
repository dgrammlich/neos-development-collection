/**
 * T3.Content.Model
 *
 * Contains the main models underlying the content module UI.
 *
 * The most central model is the "Block" model, which shadows the Aloha Block model.
 */

define(
['text!phoenix/common/launcher.html'],
function(launcherTemplate) {

	var T3 = window.T3 || {};
	T3.Content = T3.Content || {};
	T3.Content.Model = {};
	var $ = window.alohaQuery || window.jQuery;

	/**
	 * T3.Content.Model.Block
	 *
	 * The most central model class, which represents a single content element, and wraps and
	 * extends an Aloha Block for use in SproutCore, so we can use data binding on it.
	 */
	var Block = SC.Object.extend({
		alohaBlockId: null,
		_title:null,
		_originalValues: null,
		_modified: false,

		/**
		 * @var {String}
		 * The TYPO3CR node path of the block
		 */
		nodePath: function() {
			return this.get('about');
		}.property('about').cacheable(),

		/**
		 * @var {boolean}
		 * A node is publishable if it is not in the live workspace.
		 */
		_publishable: function() {
			return (this.get('_workspacename') !== 'live');
		}.property('_workspacename').cacheable(),

		/**
		 * Triggered each time "publishable" and "modified" properties change.
		 *
		 * If something is *publishable* and *modified*, i.e. is already saved
		 * in the current workspace AND has more local changes, the system
		 * will NOT publish the not-visible changes.
		 *
		 * TODO: does the above make sense?
		 */
		_onStateChange: function() {
			var alohaBlock = Aloha.Block.BlockManager.getBlock(this.get('alohaBlockId'));
			if (this.get('_modified')) {
				alohaBlock.attr('_status', 'modified');
				Changes.addChange(this);
				PublishableBlocks.remove(this);
			} else if (this.get('_publishable')) {
				alohaBlock.attr('_status', 'publishable');
				Changes.removeChange(this);
				PublishableBlocks.add(this);
			} else {
				alohaBlock.attr('_status', '');
				Changes.removeChange(this);
				PublishableBlocks.remove(this);
			}
		}.observes('_publishable', '_modified'),

		// Some hack which is fired when we change a property. Should be replaced with a proper API method which should be fired *every time* a property is changed.
		_somePropertyChanged: function(that, propertyName) {
			var alohaBlock = Aloha.Block.BlockManager.getBlock(this.get('alohaBlockId'));
			// Save original property back to Aloha Block
			if (!this._disableAlohaBlockUpdate) {
				alohaBlock.attr(propertyName, this.get(propertyName));
			}
			var hasChanges = false;
			$.each(this._originalValues, function(key, value) {
				if (that.get(key) !== value) {
					hasChanges = true;
				}
			});
			this.set('_modified', hasChanges);
		},
		schema: function() {
			var alohaBlock = Aloha.Block.BlockManager.getBlock(this.get('alohaBlockId'));
			return alohaBlock.getSchema();
		}.property().cacheable(),

		revertChanges: function() {
			var that = this;
			$.each(this._originalValues, function(key, oldValue) {
				that.set(key, oldValue);
			});
		},

		/**
		 * Returns a simple JSON object containing the simple and cleaned
		 * attributes for the block
		 */
		getCleanedUpAttributes: function() {
			var that = this, cleanedAttributes = {};
			$.each(this._originalValues, function(key) {
				cleanedAttributes[key] = that.get(key);
			});

			return cleanedAttributes;
		},
		recordCurrentStateAsOriginal: function() {
			var that = this;
			$.each(this._originalValues, function(key) {
				that._originalValues[key] = that.get(key);
			});
		},

		// HACK for making updates of editables work...
		_doNotUpdateAlohaBlock: function() {
			this._disableAlohaBlockUpdate = true;
		},
		_enableAlohaBlockUpdateAgain: function() {
			this._disableAlohaBlockUpdate = false;
		}
	});

	/**
	 * T3.Content.Model.BlockManager
	 *
	 * Should be used to get an instance of a T3.Content.Model.Block, when
	 * an Aloha Block is given. Is only used internally.
	 *
	 * @internal
	 */
	var BlockManager = SC.Object.create({
		_blocks: {},
		_blocksByNodePath: {},

		initializeBlocks: function() {
			var scope = this;
			$('*[about]').each(function() {
				// Just fetch the block a single time so that it is initialized.
				scope.getBlockByNodePath($(this).attr('about'));
			})
		},
		/**
		 * @param block/block Aloha Block instance
		 * @return {T3.Content.Model.Block}
		 */
		getBlockProxy: function(alohaBlock) {
			var blockId = alohaBlock.getId();
			if (this._blocks[blockId]) {
				return this._blocks[blockId];
			}


			var attributes = {};
			var internalAttributes = {};

			$.each(alohaBlock.attr(), function(key, value) {
				if (key[0] === '_') {
					internalAttributes[key] = value;
				} else {
					attributes[key] = value;
				}
			});

			var blockProxy = Block.create($.extend({}, attributes, {
				alohaBlockId: blockId,
				_title: alohaBlock.title,
				_originalValues: null,
				init: function() {
					var that = this;
					this._originalValues = {};

					// HACK: Add observer for each element, as we do not know how to add one observer for *all* elements.
					$.each(attributes, function(key, value) {
						// HACK: This is for supporting more data types, i.e. mostly for boolean values in checkboxes.
						if (value == "true") {
							value = true;
						} else if (value == "false") {
							value = false;
						}
						that._originalValues[key] = value;
						that.addObserver(key, that, that._somePropertyChanged);
					});
				}
			}));
			$.each(internalAttributes, function(key, value) {
				blockProxy.set(key, value);
			})

			this._blocks[blockId] = blockProxy;

			this._blocksByNodePath[blockProxy.get('nodePath')] = blockProxy;
			return this._blocks[blockId];
		},

		/**
		 * Retrieve block instance for a certain TYPO3CR Node Path
		 *
		 * @param {String} nodePath
		 * @return {T3.Content.Model.Block}
		 */
		getBlockByNodePath: function(nodePath) {
			if(this._blocksByNodePath[nodePath]) {
				return this._blocksByNodePath[nodePath];
			}
			var alohaBlock = Aloha.Block.BlockManager.getBlock($('[about="' + nodePath + '"]'));

			if (alohaBlock) {
				return this.getBlockProxy(alohaBlock);
			}
			return undefined;
		}
	});

	/**
	 * T3.Content.Model.BlockSelection
	 *
	 * Contains the currently selected blocks.
	 *
	 * This model is the one most listened to, as when the block selection changes, the UI
	 * is responding to that.
	 */
	var BlockSelection = SC.Object.create({
		blocks: [],

		/**
		 * Update the selection. If we have a block activated, we add the CSS class "t3-contentelement-selected" to the body
		 * so that we can modify the appearance of the block handles.
		 */
		updateSelection: function(blocks) {
			if (this._updating) {
				return;
			}
			this._updating = true;

			if (blocks === undefined || blocks === null || blocks === [] || blocks.length == 0) {
				blocks = [];
				$('body').removeClass('t3-contentelement-selected');
			} else {
				$('body').addClass('t3-contentelement-selected');
			}
			if (blocks.length > 0 && typeof blocks[0].getSchema !== 'undefined') {
				blocks = $.map(blocks, function(alohaBlock) {

					if (alohaBlock.id === 't3-page') {
						return alohaBlock; // FIXME: Special case for editing pages
					} else {
						return T3.Content.Model.BlockManager.getBlockProxy(alohaBlock);
					}
				});
			}
			this.set('blocks', blocks);
			this._updating = false;
		},

		selectedBlock: function() {
			var blocks = this.get('blocks');
			return blocks.length > 0 ? blocks[0]: null;
		}.property('blocks').cacheable(),

		selectedBlockSchema: function() {
			var selectedBlock = this.get('selectedBlock');
			if (!selectedBlock) return;
			return selectedBlock.get('schema');
		}.property('selectedBlock').cacheable(),

		selectPage: function() {
			Aloha.Block.BlockManager._deactivateActiveBlocks();

			var blocks = [
				new T3.Content.UI.BreadcrumbPage()
			];

			this.updateSelection(blocks);
		},

		selectItem: function(item) {
			var block = Aloha.Block.BlockManager.getBlock(item.id);
			if (block) {
				// FIXME !!! This is to prevent the event triggering a refresh of the blocks which trigger an event and kill the selection
				this._updating = true;
				block.activate();
				this._updating = false;
			}
		}
	});


	var sendAllToServer = function(collection, cleanupFn, extDirectFn, callback) {
		var numberOfUnsavedRecords = collection.get('length');
		var responseCallback = function() {
			numberOfUnsavedRecords--;
			if (numberOfUnsavedRecords <= 0) {
				callback();
			}
		}
		collection.forEach(function(element) {
			var args = cleanupFn(element);
			args.push(responseCallback);
			extDirectFn.apply(this, args);
		})
	};
	var PublishableBlocks = SC.ArrayProxy.create({

		content: [],

		noChanges: function() {
			return this.get('length') == 0;
		}.property('length').cacheable(),

		add: function(block) {
			if (!this.contains(block)) {
				this.pushObject(block);
			}
		},
		remove: function(block) {
			this.removeObject(block);
		},

		/**
		 * Publish all blocks which are unsaved *and* on current page.
		 */
		publishAll: function() {
			sendAllToServer(
				this,
				function(block) {
					return [block.get('nodePath'), 'live'];
				},
				TYPO3_TYPO3_Service_ExtDirect_V1_Controller_WorkspaceController.publishNode,
				function() {
					window.document.location.reload();
				}
			);

				// Flush local changes so the UI updates
			this.set('[]', []);
		}
	});

	/**
	 * T3.Content.Model.Changes
	 *
	 * Contains a list of Blocks which contain changes.
	 *
	 * TODO: On saving, should empty local storage!
	 */
	var Changes = SC.ArrayProxy.create({
		content: [],

		_loadedFromLocalStore: false,

		addChange: function(block) {
			if (!this.contains(block)) {
				this.pushObject(block);
			}
		},
		removeChange: function(block) {
			this.removeObject(block);
		},

		noChanges: function() {
			return this.get('length') == 0;
		}.property('length').cacheable(),

		_readFromLocalStore: function() {
			if (!this._supports_html5_storage()) return;

			var serializedBlocks = window.localStorage['page_' + $('body').attr('about')];

			if (serializedBlocks) {
				var blocks = JSON.parse(serializedBlocks);
				blocks.forEach(function(serializedBlock) {
					var blockProxy = T3.Content.Model.BlockManager.getBlockByNodePath(serializedBlock.about);
					if (blockProxy) {
						$.each(serializedBlock, function(k, v) {
							blockProxy.set(k, v);
						});
					} else {
						// TODO: warning: Somehow the block was not found on the page anymore
					}
				});
			}
			this._loadedFromLocalStore = true;
		},

		_saveToLocalStore: function() {
			if (!this._supports_html5_storage()) return;
			if (!this._loadedFromLocalStore) return;

			var cleanedUpBlocks = this.get('[]').map(function(block) {
				return block.getCleanedUpAttributes();
			});

			window.localStorage['page_' + $('body').attr('about')] = JSON.stringify(cleanedUpBlocks);
		}.observes('[]'),

		_supports_html5_storage: function() {
			try {
				return 'localStorage' in window && window['localStorage'] !== null;
			} catch (e) {
				return false;
			}
		},

		revert: function() {
			this.forEach(function(block) {
				block.revertChanges();
			}, this);
		},
		save: function() {
			sendAllToServer(
				this,
				function(block) {
					block.recordCurrentStateAsOriginal();

					var attributes = block.getCleanedUpAttributes();
					attributes['__contextNodePath'] = attributes['about'];
					delete attributes['about'];
					delete attributes['block-type'];

					return [attributes];
				},
				TYPO3_TYPO3_Service_ExtDirect_V1_Controller_NodeController.update,
				function() {
					window.document.location.reload();
				}
			);

				// Flush local changes
			this.set('[]', []);
		}
	});

	T3.Content.Model = {
		Block: Block,
		BlockManager: BlockManager,
		BlockSelection: BlockSelection,
		Changes: Changes,
		PublishableBlocks: PublishableBlocks
	}
	window.T3 = T3;
});