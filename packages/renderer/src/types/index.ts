export interface Patch {
  dir: string;
  patch: {
    JamManPatch: {
      $: {
        xmlns: string;
        device: string;
        version: string;
      };
      PatchName: string[];
      RhythmType: string[];
      StopMode: string[];
      SettingsVersion: string[];
      ID: string[];
      OriginID: string[];
      Metadata: string[];
    };
  };
  phrases: {
    dir: string;
    data: {
      JamManPhrase: {
        $: {
          xmlns: string;
          version: string;
        };
        BeatsPerMinute: string[];
        BeatsPerMeasure: string[];
        BpmValidated: string[];
        IsLoop: string[];
        IsReversed: string[];
        SettingsVersion: string[];
        AudioVersion: string[];
        ID: string[];
        OriginID: string[];
        Metadata: string[];
      };
    };
  }[];
}

/*
[
    {
        "dir": "Patch01",
        "patch": {
            "JamManPatch": {
                "$": {
                    "xmlns": "http://schemas.digitech.com/JamMan/Patch",
                    "device": "JamManStereo",
                    "version": "1"
                },
                "PatchName": [
                    ""
                ],
                "RhythmType": [
                    "StudioKickAndHighHat"
                ],
                "StopMode": [
                    "StopInstantly"
                ],
                "SettingsVersion": [
                    "1"
                ],
                "ID": [
                    "9d895fde-1dd3-11b2-8ef7-f1ab38a9fb4e"
                ],
                "OriginID": [
                    "46894d76-1dd2-11b2-a243-39fc20d425a0"
                ],
                "Metadata": [
                    ""
                ]
            }
        },
        "phrases": [
            {
                "dir": "PhraseA",
                "data": {
                    "JamManPhrase": {
                        "$": {
                            "xmlns": "http://schemas.digitech.com/JamMan/Phrase",
                            "version": "1"
                        },
                        "BeatsPerMinute": [
                            "110.2573089600"
                        ],
                        "BeatsPerMeasure": [
                            "4"
                        ],
                        "BpmValidated": [
                            "0"
                        ],
                        "IsLoop": [
                            "0"
                        ],
                        "IsReversed": [
                            "0"
                        ],
                        "SettingsVersion": [
                            "2"
                        ],
                        "AudioVersion": [
                            "1"
                        ],
                        "ID": [
                            "9d8dcca4-1dd3-11b2-8ef7-9f5ce13b8653"
                        ],
                        "OriginID": [
                            "468be57c-1dd2-11b2-a243-37bc7839cafa"
                        ],
                        "Metadata": [
                            ""
                        ]
                    }
                }
            }
        ]
    },
    {
        "dir": "Patch02",
        "patch": {
            "JamManPatch": {
                "$": {
                    "xmlns": "http://schemas.digitech.com/JamMan/Patch",
                    "device": "JamManStereo",
                    "version": "1"
                },
                "PatchName": [
                    ""
                ],
                "RhythmType": [
                    "StudioKickAndHighHat"
                ],
                "StopMode": [
                    "StopInstantly"
                ],
                "SettingsVersion": [
                    "1"
                ],
                "ID": [
                    "48a2f1b4-1dd9-11b2-8ef7-b1bfd1a527b2"
                ],
                "OriginID": [
                    "46894d76-1dd2-11b2-a243-39fc20d425a0"
                ],
                "Metadata": [
                    ""
                ]
            }
        },
        "phrases": [
            {
                "dir": "PhraseA",
                "data": {
                    "JamManPhrase": {
                        "$": {
                            "xmlns": "http://schemas.digitech.com/JamMan/Phrase",
                            "version": "1"
                        },
                        "BeatsPerMinute": [
                            "110.3498153687"
                        ],
                        "BeatsPerMeasure": [
                            "4"
                        ],
                        "BpmValidated": [
                            "0"
                        ],
                        "IsLoop": [
                            "0"
                        ],
                        "IsReversed": [
                            "0"
                        ],
                        "SettingsVersion": [
                            "2"
                        ],
                        "AudioVersion": [
                            "1"
                        ],
                        "ID": [
                            "48a75e7a-1dd9-11b2-8ef7-f3f78ccdcade"
                        ],
                        "OriginID": [
                            "468be57c-1dd2-11b2-a243-37bc7839cafa"
                        ],
                        "Metadata": [
                            ""
                        ]
                    }
                }
            }
        ]
    },
    {
        "dir": "Patch03",
        "patch": {
            "JamManPatch": {
                "$": {
                    "xmlns": "http://schemas.digitech.com/JamMan/Patch",
                    "device": "JamManStereo",
                    "version": "1"
                },
                "PatchName": [
                    ""
                ],
                "RhythmType": [
                    "StudioKickAndHighHat"
                ],
                "StopMode": [
                    "StopInstantly"
                ],
                "SettingsVersion": [
                    "1"
                ],
                "ID": [
                    "ee15869c-1dda-11b2-8ef7-a9cb1139bd48"
                ],
                "OriginID": [
                    "46894d76-1dd2-11b2-a243-39fc20d425a0"
                ],
                "Metadata": [
                    ""
                ]
            }
        },
        "phrases": [
            {
                "dir": "PhraseA",
                "data": {
                    "JamManPhrase": {
                        "$": {
                            "xmlns": "http://schemas.digitech.com/JamMan/Phrase",
                            "version": "1"
                        },
                        "BeatsPerMinute": [
                            "110.2533798218"
                        ],
                        "BeatsPerMeasure": [
                            "4"
                        ],
                        "BpmValidated": [
                            "0"
                        ],
                        "IsLoop": [
                            "0"
                        ],
                        "IsReversed": [
                            "0"
                        ],
                        "SettingsVersion": [
                            "2"
                        ],
                        "AudioVersion": [
                            "1"
                        ],
                        "ID": [
                            "ee19f362-1dda-11b2-8ef7-2f5bec27996a"
                        ],
                        "OriginID": [
                            "468be57c-1dd2-11b2-a243-37bc7839cafa"
                        ],
                        "Metadata": [
                            ""
                        ]
                    }
                }
            }
        ]
    }
]
*/
