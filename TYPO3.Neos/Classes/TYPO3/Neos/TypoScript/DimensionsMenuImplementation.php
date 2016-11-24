<?php
namespace Neos\Neos\TypoScript;

use Neos\Eel\FlowQuery\FlowQuery;
use Neos\Flow\Annotations as Flow;
use Neos\Neos\Domain\Service\ConfigurationContentDimensionPresetSource;
use TYPO3\TYPO3CR\Domain\Model\NodeInterface;
use TYPO3\TYPO3CR\Domain\Service\ContentDimensionCombinator;
use TYPO3\TypoScript\Exception as TypoScriptException;

/**
 * TypoScript implementation for a dimensions menu.
 *
 * The items generated by this menu will be all possible variants (according to the configured dimensions
 * and presets) of the given node (including the given node).
 *
 * If a 'dimension' is configured via TypoScript, only the possible variants for that dimension will
 * be included in the menu, any other dimensions will be kept from the current context.
 *
 * Main Options:
 * - dimension (optional, string): name of the dimension which this menu should be limited to. Example: "language".
 * - presets (optional, array): If set, the presets are not loaded from the Settings, but instead taken from this property. Must be used with "dimension" set.
 */
class DimensionsMenuImplementation extends AbstractMenuImplementation
{

    /**
     * @Flow\Inject
     * @var ConfigurationContentDimensionPresetSource
     */
    protected $configurationContentDimensionPresetSource;

    /**
     * @Flow\Inject
     * @var ContentDimensionCombinator
     */
    protected $contentDimensionCombinator;

    /**
     * @return string
     */
    public function getDimension()
    {
        return $this->tsValue('dimension');
    }

    /**
     * @return array
     */
    public function getPresets()
    {
        return $this->tsValue('presets');
    }

    /**
     * @return array
     */
    public function getIncludeAllPresets()
    {
        return $this->tsValue('includeAllPresets');
    }

    /**
     * Builds the array of Menu items for this variant menu
     */
    protected function buildItems()
    {
        $menuItems = [];
        $targetDimensionsToMatch = [];
        $allDimensionPresets = $this->configurationContentDimensionPresetSource->getAllPresets();
        $includeAllPresets = $this->getIncludeAllPresets();
        $pinnedDimensionValues = $this->getPresets();

        $pinnedDimensionName = $this->getDimension();
        if ($pinnedDimensionName !== null) {
            $targetDimensionsToMatch = $this->currentNode->getContext()->getTargetDimensions();
            unset($targetDimensionsToMatch[$pinnedDimensionName]);
        }

        foreach ($this->contentDimensionCombinator->getAllAllowedCombinations() as $allowedCombination) {
            $targetDimensions = $this->calculateTargetDimensionsForCombination($allowedCombination);

            if ($pinnedDimensionName !== null && is_array($pinnedDimensionValues)) {
                if (!in_array($targetDimensions[$pinnedDimensionName], $pinnedDimensionValues)) {
                    continue;
                }
            }

            // skip variants not matching the current target dimensions (except the dimension this menu covers)
            if ($targetDimensionsToMatch !== []) {
                foreach ($targetDimensionsToMatch as $dimensionName => $dimensionValue) {
                    if ($targetDimensions[$dimensionName] !== $dimensionValue) {
                        continue 2;
                    }
                }
            }

            $nodeInDimensions = $this->getNodeInDimensions($allowedCombination, $targetDimensions);

            // no match, so we look further...
            if ($nodeInDimensions === null && $includeAllPresets) {
                $nodeInDimensions = $this->findAcceptableNode($allowedCombination, $allDimensionPresets);
            }

            if ($nodeInDimensions !== null && $this->isNodeHidden($nodeInDimensions)) {
                $nodeInDimensions = null;
            }

            // determine metadata for target dimensions of node
            array_walk($targetDimensions, function (&$dimensionValue, $dimensionName, $allDimensionPresets) use ($pinnedDimensionName) {
                $dimensionValue = [
                    'value' => $dimensionValue,
                    'label' => $allDimensionPresets[$dimensionName]['presets'][$dimensionValue]['label'],
                    'isPinnedDimension' => ($pinnedDimensionName === null || $dimensionName == $pinnedDimensionName) ? true : false
                ];
            }, $allDimensionPresets);

            if ($pinnedDimensionName === null) {
                $itemLabel = $nodeInDimensions->getLabel();
            } else {
                $itemLabel = $targetDimensions[$pinnedDimensionName]['label'];
            }

            $menuItems[] = [
                'node' => $nodeInDimensions,
                'state' => $this->calculateItemState($nodeInDimensions),
                'label' => $itemLabel,
                'dimensions' => $allowedCombination,
                'targetDimensions' => $targetDimensions
            ];
        }

        // sort/limit according to configured "presets" if needed
        if ($pinnedDimensionName !== null && is_array($pinnedDimensionValues)) {
            $sortedMenuItems = [];
            foreach ($pinnedDimensionValues as $pinnedDimensionValue) {
                foreach ($menuItems as $menuItemKey => $menuItem) {
                    if ($menuItem['targetDimensions'][$pinnedDimensionName]['value'] === $pinnedDimensionValue) {
                        $sortedMenuItems[$menuItemKey] = $menuItem;
                    }
                }
            }

            return $sortedMenuItems;
        }

        return $menuItems;
    }

    /**
     * Get the current node in the given dimensions.
     * If it doesn't exist the method returns null.
     *
     * @param array $dimensions
     * @param array $targetDimensions
     * @return NodeInterface|null
     */
    protected function getNodeInDimensions(array $dimensions, array $targetDimensions)
    {
        $q = new FlowQuery([$this->currentNode]);

        return $q->context([
            'dimensions' => $dimensions,
            'targetDimensions' => $targetDimensions
        ])->get(0);
    }

    /**
     *
     * @param array $allowedCombination
     * @param $allDimensionPresets
     * @return null|NodeInterface
     */
    protected function findAcceptableNode(array $allowedCombination, array $allDimensionPresets)
    {
        $pinnedDimensionName = $this->getDimension();
        foreach ($allowedCombination[$pinnedDimensionName] as $allowedPresetIdentifier) {
            $acceptableCombination = [$pinnedDimensionName => $allDimensionPresets[$pinnedDimensionName]['presets'][$allowedPresetIdentifier]['values']];
            $allowedAdditionalPresets = $this->configurationContentDimensionPresetSource->getAllowedDimensionPresetsAccordingToPreselection('country', [$pinnedDimensionName => $allowedPresetIdentifier]);
            foreach ($allowedAdditionalPresets as $allowedAdditionalDimensionName => $allowedAdditionalPreset) {
                $acceptableCombination[$allowedAdditionalDimensionName] = $allowedAdditionalPreset['presets'][$allowedAdditionalPreset['defaultPreset']]['values'];
            }
            $nodeInDimensions = $this->getNodeInDimensions($acceptableCombination, []);
            if ($nodeInDimensions !== null) {
                return $nodeInDimensions;
            }
        }

        return null;
    }

    /**
     * Calculates the target dimensions for a given dimension combination.
     *
     * @param array $dimensionCombination
     * @return array
     */
    protected function calculateTargetDimensionsForCombination(array $dimensionCombination)
    {
        $targetDimensions = [];
        foreach ($dimensionCombination as $dimensionName => $dimensionValues) {
            $targetDimensions[$dimensionName] = reset($dimensionValues);
        }

        return $targetDimensions;
    }
}
